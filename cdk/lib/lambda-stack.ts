import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as kinesis from 'aws-cdk-lib/aws-kinesis';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from 'path';

interface LambdaStackProps extends cdk.StackProps {
  accessLogStream: kinesis.Stream;
  incidentsTable: dynamodb.Table;
  accessPatternsTable: dynamodb.Table;
  alertTopic: sns.Topic;
}

export class LambdaStack extends cdk.Stack {
  public readonly anomalyDetector: nodejs.NodejsFunction;

  constructor(scope: Construct, id: string, props: LambdaStackProps) {
    super(scope, id, props);

    // AI検知Lambda関数
    this.anomalyDetector = new nodejs.NodejsFunction(
      this,
      'AnomalyDetector',
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        entry: path.join(
          __dirname,
          '../../lambda/anomaly-detector/index.ts'
        ),
        handler: 'handler',
        timeout: cdk.Duration.seconds(60),
        memorySize: 256,
        bundling: {
          forceDockerBundling: false,
          externalModules: [
            '@aws-sdk/client-bedrock-runtime',
            '@aws-sdk/client-dynamodb',
            '@aws-sdk/lib-dynamodb',
            '@aws-sdk/client-sns',
          ],
        },
        environment: {
          INCIDENTS_TABLE: props.incidentsTable.tableName,
          ACCESS_PATTERNS_TABLE: props.accessPatternsTable.tableName,
          ALERT_TOPIC_ARN: props.alertTopic.topicArn,
        },
      }
    );

    // KinesisをLambdaのトリガーに設定
    this.anomalyDetector.addEventSource(
      new lambdaEventSources.KinesisEventSource(props.accessLogStream, {
        startingPosition: lambda.StartingPosition.LATEST,
        batchSize: 10,
        bisectBatchOnError: true,
      })
    );

    // DynamoDBへのアクセス権限
    props.incidentsTable.grantReadWriteData(this.anomalyDetector);
    props.accessPatternsTable.grantReadWriteData(this.anomalyDetector);

    // SNSへの通知権限
    props.alertTopic.grantPublish(this.anomalyDetector);

    // BedrockへのアクセスIAMポリシー
    this.anomalyDetector.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['bedrock:InvokeModel'],
        resources: ['*'],
      })
    );

    // 出力
    new cdk.CfnOutput(this, 'AnomalyDetectorArn', {
      value: this.anomalyDetector.functionArn,
      description: 'Anomaly Detector Lambda ARN',
    });
  }
}
