import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import {
  DynamoDBClient,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  SNSClient,
  PublishCommand,
} from '@aws-sdk/client-sns';
import { KinesisStreamEvent } from 'aws-lambda';
import { randomUUID } from 'crypto';

const bedrockClient = new BedrockRuntimeClient({
  region: process.env.AWS_REGION,
});
const dynamoClient = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: process.env.AWS_REGION })
);
const snsClient = new SNSClient({ region: process.env.AWS_REGION });

// アクセスログの型定義
interface AccessLog {
  sourceIp: string;
  userId: string;
  endpoint: string;
  method: string;
  statusCode: number;
  timestamp: string;
  amount?: number;
}

// アクセスパターンの集計結果
interface AccessPattern {
  sourceIp: string;
  requestCount: number;
  uniqueUserIds: string[];
  endpoints: string[];
  statusCodes: number[];
  amounts: number[];
  timeWindow: string;
  hour: number;
  dayOfWeek: number;
}

// Kinesisレコードをデコードしてアクセスログを取得
const decodeRecord = (data: string): AccessLog => {
  const decoded = Buffer.from(data, 'base64').toString('utf-8');
  return JSON.parse(decoded);
};

// アクセスパターンをDynamoDBに集計・保存
const updateAccessPattern = async (
  log: AccessLog
): Promise<AccessPattern> => {
  const now = new Date(log.timestamp);
  const windowStart = new Date(now);
  windowStart.setMinutes(Math.floor(now.getMinutes() / 5) * 5, 0, 0);
  const windowStartStr = windowStart.toISOString();

  const existing = await dynamoClient.send(
    new GetCommand({
      TableName: process.env.ACCESS_PATTERNS_TABLE,
      Key: {
        sourceIp: log.sourceIp,
        windowStart: windowStartStr,
      },
    })
  ).catch(() => ({ Item: null }));

  const pattern = existing.Item || {
    sourceIp: log.sourceIp,
    windowStart: windowStartStr,
    requestCount: 0,
    uniqueUserIds: [],
    endpoints: [],
    statusCodes: [],
    amounts: [],
    ttl: Math.floor(Date.now() / 1000) + 86400, // 24時間後に自動削除
  };

  pattern.requestCount += 1;
  if (!pattern.uniqueUserIds.includes(log.userId)) {
    pattern.uniqueUserIds.push(log.userId);
  }
  pattern.endpoints.push(log.endpoint);
  pattern.statusCodes.push(log.statusCode);
  if (log.amount) pattern.amounts.push(log.amount);

  await dynamoClient.send(
    new PutCommand({
      TableName: process.env.ACCESS_PATTERNS_TABLE,
      Item: pattern,
    })
  );

  return {
    ...pattern,
    timeWindow: windowStartStr,
    hour: now.getUTCHours() + 9, // JST変換
    dayOfWeek: now.getUTCDay(),
  };
};

// BedrockのClaudeに異常検知を依頼
const analyzeWithBedrock = async (
  pattern: AccessPattern
): Promise<{ threatLevel: string; reason: string; recommendation: string }> => {
  const prompt = `
あなたは金融システムのセキュリティアナリストです。
以下のAPIアクセスパターンを分析して脅威レベルを判定してください。

## アクセスパターン
- 送信元IP: ${pattern.sourceIp}
- 5分間のリクエスト数: ${pattern.requestCount}
- アクセスしたユニークユーザー数: ${pattern.uniqueUserIds.length}
- アクセスしたエンドポイント: ${[...new Set(pattern.endpoints)].join(', ')}
- エラーレスポンス数: ${pattern.statusCodes.filter(s => s >= 400).length}
- 取引金額一覧（円）: ${pattern.amounts.join(', ') || 'なし'}
- アクセス時刻（JST）: ${pattern.hour}時
- 曜日: ${['日', '月', '火', '水', '木', '金', '土'][pattern.dayOfWeek]}曜日

## 判定基準
- SAFE: 正常なアクセスパターン
- LOW: わずかに不審だが通常範囲内
- MEDIUM: 注意が必要な不審なパターン
- HIGH: 明らかに不審・即座に対応が必要
- CRITICAL: 攻撃の可能性が極めて高い

以下のJSON形式のみで回答してください（説明文は不要）:
{
  "threatLevel": "SAFE|LOW|MEDIUM|HIGH|CRITICAL",
  "reason": "判定理由を日本語で簡潔に",
  "recommendation": "推奨対応を日本語で簡潔に"
}`;

  const command = new InvokeModelCommand({
    modelId: 'apac.anthropic.claude-3-sonnet-20240229-v1:0',
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const response = await bedrockClient.send(command);
  const responseBody = JSON.parse(
    new TextDecoder().decode(response.body)
  );

  const text = responseBody.content[0].text;
  const clean = text.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
};

// 検知結果をDynamoDBに保存
const saveIncident = async (
  pattern: AccessPattern,
  analysis: { threatLevel: string; reason: string; recommendation: string }
): Promise<string> => {
  const incidentId = `inc-${randomUUID()}`;
  const timestamp = new Date().toISOString();

  await dynamoClient.send(
    new PutCommand({
      TableName: process.env.INCIDENTS_TABLE,
      Item: {
        incidentId,
        timestamp,
        sourceIp: pattern.sourceIp,
        threatLevel: analysis.threatLevel,
        reason: analysis.reason,
        recommendation: analysis.recommendation,
        requestCount: pattern.requestCount,
        uniqueUserCount: pattern.uniqueUserIds.length,
        status: 'OPEN',
      },
    })
  );

  return incidentId;
};

// HIGH以上の脅威はSNSでアラート通知
const sendAlert = async (
  incidentId: string,
  pattern: AccessPattern,
  analysis: { threatLevel: string; reason: string; recommendation: string }
): Promise<void> => {
  const message = `
【セキュリティアラート】不審なアクセスを検知しました

インシデントID: ${incidentId}
脅威レベル: ${analysis.threatLevel}
検知日時: ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}
送信元IP: ${pattern.sourceIp}
5分間リクエスト数: ${pattern.requestCount}
アクセスユーザー数: ${pattern.uniqueUserIds.length}

AIによる分析:
${analysis.reason}

推奨対応:
${analysis.recommendation}

詳細はCloudWatch Logsで確認してください。
ロググループ: /aws/lambda/AnomalyDetector
  `;

  await snsClient.send(
    new PublishCommand({
      TopicArn: process.env.ALERT_TOPIC_ARN,
      Subject: `【${analysis.threatLevel}】セキュリティアラート - ${pattern.sourceIp}`,
      Message: message,
    })
  );
};

// メインハンドラー
export const handler = async (event: KinesisStreamEvent): Promise<void> => {
  console.log(`処理するレコード数: ${event.Records.length}`);

  for (const record of event.Records) {
    try {
      // ① Kinesisレコードをデコード
      const log = decodeRecord(record.kinesis.data);
      console.log('アクセスログ:', JSON.stringify(log));

      // ② アクセスパターンを集計
      const pattern = await updateAccessPattern(log);
      console.log('アクセスパターン:', JSON.stringify(pattern));

      // ③ 5リクエスト以上溜まったらAIで分析
      if (pattern.requestCount >= 5) {
        console.log('Bedrockで分析開始...');
        const analysis = await analyzeWithBedrock(pattern);
        console.log('AI分析結果:', JSON.stringify(analysis));

        // ④ 検知結果をDynamoDBに保存
        const incidentId = await saveIncident(pattern, analysis);
        console.log('インシデント保存完了:', incidentId);

        // ⑤ HIGH以上はアラート発報
        if (['HIGH', 'CRITICAL'].includes(analysis.threatLevel)) {
          await sendAlert(incidentId, pattern, analysis);
          console.log('アラート発報完了');
        }
      }
    } catch (error) {
      console.error('処理エラー:', error);
    }
  }
};
