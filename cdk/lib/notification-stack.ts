import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';

interface NotificationStackProps extends cdk.StackProps {
  alertEmail: string;
}

export class NotificationStack extends cdk.Stack {
  public readonly alertTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: NotificationStackProps) {
    super(scope, id, props);

    // アラート通知用SNSトピック
    this.alertTopic = new sns.Topic(this, 'SecurityAlertTopic', {
      topicName: 'AiAnomalyDetectionAlert',
      displayName: 'AI不正検知アラート',
    });

    // メール通知の設定
    this.alertTopic.addSubscription(
      new snsSubscriptions.EmailSubscription(props.alertEmail)
    );

    // CloudWatchアラーム1: HIGH以上の検知数監視
    const highThreatAlarm = new cloudwatch.Alarm(this, 'HighThreatAlarm', {
      alarmName: 'AiAnomaly-HighThreatDetected',
      alarmDescription: 'HIGH以上の脅威が検知されました',
      metric: new cloudwatch.Metric({
        namespace: 'AiAnomalyDetection',
        metricName: 'HighThreatCount',
        statistic: 'Sum',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator:
        cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // CloudWatchアラーム2: CRITICAL検知数監視
    const criticalThreatAlarm = new cloudwatch.Alarm(this, 'CriticalThreatAlarm', {
      alarmName: 'AiAnomaly-CriticalThreatDetected',
      alarmDescription: 'CRITICALの脅威が検知されました。即時対応が必要です。',
      metric: new cloudwatch.Metric({
        namespace: 'AiAnomalyDetection',
        metricName: 'CriticalThreatCount',
        statistic: 'Sum',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator:
        cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // アラーム発生時にSNS通知
    const snsAction = new cloudwatchActions.SnsAction(this.alertTopic);
    highThreatAlarm.addAlarmAction(snsAction);
    criticalThreatAlarm.addAlarmAction(snsAction);

    // 出力
    new cdk.CfnOutput(this, 'AlertTopicArn', {
      value: this.alertTopic.topicArn,
      description: 'SNS Alert Topic ARN',
    });
  }
}
