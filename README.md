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
┌─────────────────────────┐
│ 正常判定 → ログのみ記録  │
│ 異常判定 → SNSでアラート │
└─────────────────────────┘
    ↓
DynamoDB（検知結果保存）
CloudWatch（メトリクス可視化）
S3（長期ログ保存）
```

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
