# AWS AI不正検知システム

金融APIへの不正アクセスをAI（Amazon Bedrock）がリアルタイムで検知・分析するシステムです。
ルールベースのWAFでは検知できない未知の攻撃パターンをAIが学習・判定します。

## 🏗️ アーキテクチャ
```
APIアクセス
    ↓
Kinesis Data Streams（リアルタイムログ収集）
    ↓
Lambda（アクセスパターン集計）
    ↓
Amazon Bedrock / Claude 3 Sonnet（AIによる異常判定）
    ↓
┌─────────────────────────────────┐
│ SAFE/LOW  → ログのみ記録        │
│ MEDIUM    → DynamoDBに保存      │
│ HIGH/CRITICAL → SNSでアラート   │
└─────────────────────────────────┘
    ↓
DynamoDB（検知結果保存）
CloudWatch（メトリクス可視化）
```

## 🤖 WAFとAIの違い・補完関係

本システムはWAFと組み合わせることで多層防御を実現します。
```
層1: WAF（前回構築）
  → 既知の攻撃を即時ブロック
  → SQLインジェクション・XSS等のルールベース検知

層2: AI不正検知（本システム）
  → WAFをすり抜けた不審な行動を検知
  → 文脈・パターンを理解した複合的な判断
```

### WAFで防げなかった攻撃をAIが検知

| 攻撃パターン | WAF | AI検知 |
|------------|-----|-------|
| 分割送金（1回は正常額・繰り返す） | ❌ スルー | ✅ 検知 |
| クレデンシャルスタッフィング | ❌ スルー | ✅ 検知 |
| 深夜の不審な大量取引 | ❌ スルー | ✅ 検知 |
| 同一IPから複数アカウントへの試行 | ❌ スルー | ✅ 検知 |
| ゆっくりとしたブルートフォース | ❌ スルー | ✅ 検知 |

## 🤖 AIが検知できる不正パターン

| パターン | 内容 |
|---------|------|
| ブルートフォース攻撃 | 短時間での大量アクセス |
| 深夜不正取引 | 通常と異なる時間帯での大量取引 |
| クレデンシャルスタッフィング | 同一IPから複数アカウントへの試行 |
| 分割送金（スマーフィング） | 高額取引の繰り返し分割 |
| 海外からの不審アクセス | 通常と異なる地域からのアクセス |

## 🛠️ 使用技術

| カテゴリ | 技術 |
|---------|------|
| AI分析 | Amazon Bedrock（Claude 3 Sonnet） |
| ストリーミング | Amazon Kinesis Data Streams |
| ログ保存 | Amazon Kinesis Firehose・S3 |
| データストア | Amazon DynamoDB |
| 通知 | Amazon SNS |
| 監視 | Amazon CloudWatch |
| IaC | AWS CDK（TypeScript） |

## 📁 プロジェクト構成
```
aws-ai-anomaly-detection/
├── lambda/
│   └── anomaly-detector/
│       └── index.ts         # AI検知ロジック
└── cdk/
    └── lib/
        ├── dynamodb-stack.ts    # DynamoDB定義
        ├── kinesis-stack.ts     # Kinesis定義
        ├── notification-stack.ts # SNS・CloudWatch定義
        ├── lambda-stack.ts      # Lambda定義
        └── api-stack.ts         # API Gateway定義
```

## 🚀 デプロイ手順
```bash
cd cdk
npm install
cdk bootstrap
cdk deploy --all
```

## ✅ 動作確認

### 正常アクセスの確認
```bash
curl https://YOUR_API_URL/prod/health
→ 200 OK
```

### AI検知のトリガー（5回以上送信）
```bash
for i in {1..6}; do
  curl -X POST https://YOUR_API_URL/prod/transactions \
    -H "Content-Type: application/json" \
    -d "{
      \"sourceIp\": \"192.168.1.1\",
      \"userId\": \"user00$i\",
      \"endpoint\": \"/transactions\",
      \"method\": \"POST\",
      \"statusCode\": 200,
      \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
      \"amount\": 4900000
    }"
  sleep 1
done
```

### CloudWatch Logsで結果確認
```bash
aws logs tail /aws/lambda/FUNCTION_NAME \
  --region ap-northeast-1 \
  --since 5m \
  --format short
```

### 期待するAI分析結果
```json
{
  "threatLevel": "MEDIUM",
  "reason": "同一IPから短時間に大口の取引が複数発生しているため",
  "recommendation": "送信元IPとユーザーを特定し、正当な取引であることを確認する"
}
```

### DynamoDBで検知結果を確認
```bash
aws dynamodb scan \
  --table-name SecurityIncidents \
  --region ap-northeast-1 \
  --output json \
  --query 'Items[*].{ID:incidentId.S,Level:threatLevel.S,Reason:reason.S,Time:timestamp.S}'
```

## 🔑 AIの判定フロー
```
① APIにリクエストが来る
      ↓
② KinesisがリアルタイムでLambdaに転送
      ↓
③ DynamoDBにIPごとのアクセスパターンを蓄積
      ↓
④ 5リクエスト以上でBedrockのAI分析をトリガー
      ↓
⑤ AIが以下を複合的に判断:
   ・リクエスト数
   ・ユニークユーザー数
   ・取引金額
   ・アクセス時間帯
   ・曜日
      ↓
⑥ 脅威レベルを判定（SAFE/LOW/MEDIUM/HIGH/CRITICAL）
      ↓
⑦ HIGH以上はSNSでアラートメール送信
⑧ 全検知結果をDynamoDBに保存
```
## 🚧 構築時のトラブルシューティング

### 1. Kinesisサービスが有効化されていないエラー

**エラー内容**
```
SubscriptionRequiredException: The AWS Access Key Id needs a subscription for the service
```

**原因**

AWSアカウントでKinesisが有効化されていなかったため発生しました。
AWSアカウントを作成したばかりだと無料プランでの利用となるため、Kinesisが有効化されず利用できませんでした。
そのため無料プランからアップデートしてKinesisを有効化する必要があります。

**解決方法**

AWSコンソールでまず無料プランをアップデートすることでKinesisが有効化されました。

---

### 2. FirehoseのIAM権限エラー

**エラー内容**
```
Role is not authorized to perform: kinesis:DescribeStream
```

**原因**

FirehoseがKinesisストリームを読み取るためのIAM権限が不足していました。またFirehoseとKinesisを同一スタックで作成する際の権限の伝播タイミングにも問題がありました。

**解決方法**

Firehoseを削除してKinesisのみのシンプルな構成に変更しました。ログの長期保存はS3への直接保存ではなく別途対応する方針に切り替えました。

---

### 3. BedrockのモデルID指定エラー

**エラー内容**
```
Invocation of model ID with on-demand throughput isn't supported.
```

**原因**

AWSの仕様変更により、Bedrockのモデルを直接IDで呼び出す方式が廃止され、クロスリージョン推論プロファイルIDを使う必要がありました。

**解決方法**

以下のコマンドで正しいプロファイルIDを確認して修正しました。
```bash
aws bedrock list-inference-profiles \
  --region ap-northeast-1 \
  --query 'inferenceProfileSummaries[?contains(inferenceProfileName, `Sonnet`)].inferenceProfileId'
```
```typescript
// 修正前
modelId: 'anthropic.claude-3-sonnet-20240229-v1:0'

// 修正後
modelId: 'apac.anthropic.claude-3-sonnet-20240229-v1:0'
```

---

### 4. JSONの二重エスケープエラー

**エラー内容**
```
SyntaxError: Expected property name or '}' in JSON at position 1
```

**原因**

API GatewayのVTLテンプレートで`$util.escapeJavaScript`を使用したため、JSONが二重エスケープされてLambdaで解析できない状態になりました。

**解決方法**

`$util.escapeJavaScript`を削除してシンプルなBase64エンコードのみに変更しました。
```typescript
// 修正前
"Data": "$util.base64Encode($util.escapeJavaScript($input.body))"

// 修正後
"Data": "$util.base64Encode($input.body)"
```

## 💡 構築を通じた学び

| 学んだこと | 内容 |
|-----------|------|
| WAFとAIの役割分担 | WAFはルールベース・AIは文脈理解。両者は競合せず補完関係にある |
| Bedrockの仕様変更 | AWSのAPIは定期的に仕様変更される。CLIで最新の設定を確認する習慣が重要 |
| Kinesisの活用 | リアルタイムストリーミングはログ収集・異常検知に非常に有効 |
| AIへのプロンプト設計 | AIの判定精度はプロンプトの設計に大きく依存する |
| シンプルな構成から始める | 複雑な構成（Firehose等）は段階的に追加する方が安全 |


## 🔗 WAFゼロトラスト × AI不正検知 統合構成図

本システムは「[AWS Zero Trust API Security](https://github.com/kuri2505/aws-zero-trust-api-security)」と組み合わせることで多層防御を実現します。

```
┌─────────────────────────────────────────────────────────────────┐
│                         外部からのリクエスト                        │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  層1: AWS Shield Standard                                        │
│  ・SYN Flood / UDP Flood / Reflection攻撃を自動遮断              │
│  ・ネットワーク層（L3/L4）のDDoS防御                               │
└─────────────────────────┬───────────────────────────────────────┘
                          │ DDoS以外のリクエストを通過
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  層2: AWS WAF                            【Zero Trustで構築】     │
│  ・SQLインジェクション防御                                         │
│  ・XSS防御                                                       │
│  ・レートベースルール（5分間1,000リクエスト超でブロック）             │
│  ・IPブラックリスト                                               │
│  ❌ 防げないもの: 正常に見える不審な行動パターン                     │
└─────────────────────────┬───────────────────────────────────────┘
                          │ WAFを通過したリクエスト
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  層3: API Gateway                        【Zero Trustで構築】     │
│  ・スロットリング（1秒100リクエスト・瞬間200リクエスト）              │
│  ・CORSの設定                                                    │
└──────────┬──────────────────────────────┬───────────────────────┘
           │                              │
           ▼                              ▼
┌──────────────────────┐    ┌─────────────────────────────────────┐
│  層4: Cognito（MFA）  │    │  層5: Lambda Authorizer             │
│  【Zero Trustで構築】  │    │  【Zero Trustで構築】                 │
│  ・パスワード12文字以上 │    │  ・IPホワイトリストチェック             │
│  ・TOTP必須           │    │  ・取引時間外アクセス拒否              │
│  ・トークン有効期限30分 │    │    （平日9〜18時のみ許可）            │
└──────────┬───────────┘    └──────────────┬──────────────────────┘
           └───────────────┬───────────────┘
                           │ 認証・認可を通過
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  層6: Kinesis Data Streams                     【本システム】      │
│  ・全APIアクセスログをリアルタイム収集                               │
│  ・24時間分のデータを保持                                          │
│  ・LambdaへリアルタイムでログをPUSH                                │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  層7: Lambda（アクセスパターン分析）            【本システム】        │
│  ・IPごとのアクセスパターンをDynamoDBに蓄積                         │
│  ・5リクエスト以上でBedrockのAI分析をトリガー                       │
│  ・集計情報: リクエスト数・ユニークユーザー数・金額・時間帯・曜日       │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  層8: Amazon Bedrock（Claude 3 Sonnet）        【本システム】      │
│  ・WAFで防げなかった不審な行動パターンをAIが検知                     │
│                                                                  │
│  検知できる攻撃:                                                  │
│  ✅ 分割送金（スマーフィング）                                      │
│  ✅ クレデンシャルスタッフィング                                    │
│  ✅ 深夜の不審な大量取引                                           │
│  ✅ 同一IPから複数アカウントへの試行                                │
│  ✅ ゆっくりとしたブルートフォース                                  │
│                                                                  │
│  脅威レベル判定: SAFE → LOW → MEDIUM → HIGH → CRITICAL           │
└──────────┬──────────────────────────────────────────────────────┘
           │
           ├─── SAFE/LOW ──→ ログのみ記録
           ├─── MEDIUM ───→ DynamoDBにインシデント保存
           └─── HIGH/CRITICAL → SNSでアラートメール送信
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  層9: 監視・通知基盤                       【両プロジェクトで構築】   │
│                                                                  │
│  CloudTrail（Zero Trust）                                        │
│  ・全APIアクセスの監査ログを記録（365日保存）                        │
│  ・インシデント発生時の原因追跡に活用                                │
│                                                                  │
│  CloudWatch（両プロジェクト）                                     │
│  ・WAFブロック数・API エラー率・AI検知数のメトリクス可視化            │
│                                                                  │
│  DynamoDB（本システム）                                           │
│  ・AIが検知したインシデントの保存                                   │
│  ・アクセスパターンのベースライン管理                                │
│                                                                  │
│  SNS（両プロジェクト）                                            │
│  ・セキュリティアラートのメール通知                                  │
└─────────────────────────────────────────────────────────────────┘
```

## 🔄 2つのシステムの役割分担

| 比較項目 | WAFゼロトラスト | AI不正検知（本システム） |
|---------|--------------|----------------------|
| 対象の攻撃 | 既知の攻撃パターン | 未知の不審な行動パターン |
| 判断方法 | ルールベース | 文脈を理解した複合的な判断 |
| 応答速度 | ミリ秒（即時ブロック） | 数秒（分析後に記録・通知） |
| 検知例 | SQLi・XSS・大量リクエスト | 分割送金・複数アカウント試行 |
| アクション | リクエストを即時ブロック | アラート通知・インシデント記録 |

## 💬 設計意図

WAFは「既知の攻撃シグネチャに対するゲートキーパー」として機能しますが、個々のリクエストが正常に見える場合は検知できません。本システムはそのギャップを埋めるもので、アクセスパターン全体を時系列で分析することで、WAFをすり抜けた不正行為を検知します。

```
WAF（ゲートキーパー）: 1件1件のリクエストを即時判定
AI検知（監視カメラ）: 行動の流れ・文脈を総合的に分析
```

両者を組み合わせることで、既知・未知を問わない包括的なセキュリティ防御を実現しています。
