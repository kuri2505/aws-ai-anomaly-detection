import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as kinesis from 'aws-cdk-lib/aws-kinesis';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';

interface ApiStackProps extends cdk.StackProps {
  accessLogStream: kinesis.Stream;
}

export class ApiStack extends cdk.Stack {
  public readonly api: apigateway.RestApi;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    // API GatewayがKinesisに書き込むためのIAMロール
    const apiGatewayRole = new iam.Role(this, 'ApiGatewayKinesisRole', {
      assumedBy: new iam.ServicePrincipal('apigateway.amazonaws.com'),
    });

    props.accessLogStream.grantWrite(apiGatewayRole);

    // REST APIの作成
    this.api = new apigateway.RestApi(this, 'AnomalyDetectionApi', {
      restApiName: 'AiAnomalyDetectionApi',
      description: 'AI不正検知システムのAPI',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
      },
      deployOptions: {
        throttlingRateLimit: 100,
        throttlingBurstLimit: 200,
      },
    });

    // Kinesisへのログ送信統合
    const kinesisIntegration = new apigateway.AwsIntegration({
      service: 'kinesis',
      action: 'PutRecord',
      options: {
        credentialsRole: apiGatewayRole,
        requestTemplates: {
         'application/json': `{
          "StreamName": "${props.accessLogStream.streamName}",
          "Data": "$util.base64Encode($input.body)",
          "PartitionKey": "$context.identity.sourceIp"
        }`,
      },
        integrationResponses: [
          {
            statusCode: '200',
            responseTemplates: {
              'application/json': '{"message": "ok"}',
            },
          },
        ],
      },
    });

    // /transactions エンドポイント
    const transactions = this.api.root.addResource('transactions');
    transactions.addMethod('POST', kinesisIntegration, {
      methodResponses: [{ statusCode: '200' }],
    });
    transactions.addMethod('GET', new apigateway.MockIntegration({
      integrationResponses: [{ statusCode: '200' }],
      passthroughBehavior: apigateway.PassthroughBehavior.NEVER,
      requestTemplates: { 'application/json': '{"statusCode": 200}' },
    }), {
      methodResponses: [{ statusCode: '200' }],
    });

    // /accounts エンドポイント
    const accounts = this.api.root.addResource('accounts');
    accounts.addMethod('GET', new apigateway.MockIntegration({
      integrationResponses: [{ statusCode: '200' }],
      passthroughBehavior: apigateway.PassthroughBehavior.NEVER,
      requestTemplates: { 'application/json': '{"statusCode": 200}' },
    }), {
      methodResponses: [{ statusCode: '200' }],
    });

    // /health エンドポイント（死活監視用）
    const health = this.api.root.addResource('health');
    health.addMethod('GET', new apigateway.MockIntegration({
      integrationResponses: [{ statusCode: '200' }],
      passthroughBehavior: apigateway.PassthroughBehavior.NEVER,
      requestTemplates: { 'application/json': '{"statusCode": 200}' },
    }), {
      methodResponses: [{ statusCode: '200' }],
    });

    // APIのURLを出力
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: this.api.url,
      description: 'API Gateway URL',
    });
  }
}
