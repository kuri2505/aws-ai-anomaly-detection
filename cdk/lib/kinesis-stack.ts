import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as kinesis from 'aws-cdk-lib/aws-kinesis';

export class KinesisStack extends cdk.Stack {
  public readonly accessLogStream: kinesis.Stream;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // アクセスログ収集用Kinesisストリーム
    this.accessLogStream = new kinesis.Stream(this, 'AccessLogStream', {
      streamName: 'ApiAccessLogStream',
      streamMode: kinesis.StreamMode.ON_DEMAND,
      retentionPeriod: cdk.Duration.hours(24),
    });

    new cdk.CfnOutput(this, 'AccessLogStreamName', {
      value: this.accessLogStream.streamName,
      description: 'Kinesis Access Log Stream Name',
    });

    new cdk.CfnOutput(this, 'AccessLogStreamArn', {
      value: this.accessLogStream.streamArn,
      description: 'Kinesis Access Log Stream ARN',
    });
  }
}
