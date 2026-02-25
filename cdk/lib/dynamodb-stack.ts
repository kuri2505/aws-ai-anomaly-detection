import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';

export class DynamoDbStack extends cdk.Stack {
  public readonly incidentsTable: dynamodb.Table;
  public readonly accessPatternsTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // セキュリティインシデント保存テーブル
    // AIが検知した不審なアクセスの記録
    this.incidentsTable = new dynamodb.Table(this, 'SecurityIncidents', {
      tableName: 'SecurityIncidents',
      partitionKey: {
        name: 'incidentId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'timestamp',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // 脅威レベルで検索するためのGSI
    this.incidentsTable.addGlobalSecondaryIndex({
      indexName: 'threatLevelIndex',
      partitionKey: {
        name: 'threatLevel',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'timestamp',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // アクセスパターン保存テーブル
    // 正常パターンのベースライン管理
    this.accessPatternsTable = new dynamodb.Table(this, 'AccessPatterns', {
      tableName: 'AccessPatterns',
      partitionKey: {
        name: 'sourceIp',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'windowStart',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      // アクセスパターンは24時間で自動削除
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // 出力
    new cdk.CfnOutput(this, 'IncidentsTableName', {
      value: this.incidentsTable.tableName,
      description: 'Security Incidents Table Name',
    });

    new cdk.CfnOutput(this, 'AccessPatternsTableName', {
      value: this.accessPatternsTable.tableName,
      description: 'Access Patterns Table Name',
    });
  }
}
