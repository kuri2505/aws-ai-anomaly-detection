#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { DynamoDbStack } from '../lib/dynamodb-stack';
import { KinesisStack } from '../lib/kinesis-stack';
import { NotificationStack } from '../lib/notification-stack';
import { LambdaStack } from '../lib/lambda-stack';
import { ApiStack } from '../lib/api-stack';

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

// 1. DynamoDBスタック
const dynamoDbStack = new DynamoDbStack(app, 'DynamoDbStack', { env });

// 2. Kinesisスタック
const kinesisStack = new KinesisStack(app, 'KinesisStack', { env });

// 3. 通知スタック
const notificationStack = new NotificationStack(app, 'NotificationStack', {
  env,
  alertEmail: 'k0417kh@gmail.com', // 自分のメールアドレスに変更
});

// 4. Lambdaスタック
new LambdaStack(app, 'LambdaStack', {
  env,
  accessLogStream: kinesisStack.accessLogStream,
  incidentsTable: dynamoDbStack.incidentsTable,
  accessPatternsTable: dynamoDbStack.accessPatternsTable,
  alertTopic: notificationStack.alertTopic,
});

// 5. APIスタック
new ApiStack(app, 'ApiStack', {
  env,
  accessLogStream: kinesisStack.accessLogStream,
});
