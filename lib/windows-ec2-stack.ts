import * as cdk from 'aws-cdk-lib';
import { Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

export class WindowsEc2Stack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Use default VPC (simplest for now)
    const vpc = ec2.Vpc.fromLookup(this, 'DefaultVPC', {
      isDefault: true,
    });

    // Security group
    const sg = new ec2.SecurityGroup(this, 'RDPSecurityGroup', {
      vpc,
      description: 'Allow RDP access',
      allowAllOutbound: true,
    });

    // ⚠️ For demo only — lock this down to your IP in real usage
    sg.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(3389),
      'Allow RDP from anywhere'
    );

    // Key pair (new CDK feature - requires newer version)
    const key = new ec2.KeyPair(this, 'KeyPair', {
      keyPairName: 'windows-rdp-key',
    });

    // Windows AMI
    const ami = ec2.MachineImage.latestWindows(
      ec2.WindowsVersion.WINDOWS_SERVER_2022_ENGLISH_FULL_BASE
    );

    // UserData for Windows startup
    const userData = ec2.UserData.forWindows();
    userData.addCommands(
      '$gitInstaller = "$env:TEMP\\GitInstaller.exe"',
      'Invoke-WebRequest -Uri "https://github.com/git-for-windows/git/releases/download/v2.46.2.windows.1/Git-2.46.2-64-bit.exe" -OutFile $gitInstaller',
      'Start-Process -FilePath $gitInstaller -ArgumentList "/VERYSILENT", "/NORESTART" -Wait',
      '$vsInstaller = "$env:TEMP\\vs_community.exe"',
      'Invoke-WebRequest -Uri "https://aka.ms/vs/17/release/vs_community.exe" -OutFile $vsInstaller',
      'Start-Process -FilePath $vsInstaller -ArgumentList "--quiet", "--wait", "--norestart", "--add", "Microsoft.VisualStudio.Workload.ManagedDesktop", "--includeRecommended", "--accept-vs-licenses" -Wait',
      '$qtInstaller = "$env:TEMP\\qt-opensource-windows-x86-6.8.3.exe"',
      'Invoke-WebRequest -Uri "https://download.qt.io/official_releases/qt/6.8/6.8.3/qt-opensource-windows-x86-6.8.3.exe" -OutFile $qtInstaller',
      'Start-Process -FilePath $qtInstaller -ArgumentList "/S", "/D=C:\\Qt" -Wait',
      '$sevenZipInstaller = "$env:TEMP\\7zip.exe"',
      'Invoke-WebRequest -Uri "https://www.7-zip.org/a/7z2301-x64.exe" -OutFile $sevenZipInstaller',
      'Start-Process -FilePath $sevenZipInstaller -ArgumentList "/S" -Wait',
      '$libPackArchive = "$env:TEMP\\LibPack-1.1.0-v3.1.1.3-Release.7z"',
      'Invoke-WebRequest -Uri "https://github.com/FreeCAD/FreeCAD-LibPack/releases/download/3.1.1.3/LibPack-1.1.0-v3.1.1.3-Release.7z" -OutFile $libPackArchive',
      'New-Item -ItemType Directory -Path "C:\\FreeCADLibPack" -Force | Out-Null',
      'Start-Process -FilePath "C:\\Program Files\\7-Zip\\7z.exe" -ArgumentList "x", $libPackArchive, "-oC:\\LibPack-1.1.0-v3.1.1.3-Release", "-y" -Wait',
      'Write-Output "Git, Visual Studio 2022, Qt 6.8.3, and FreeCAD LibPack installed."'
    );

    const publicSubnetSelection = vpc.selectSubnets({ subnetType: ec2.SubnetType.PUBLIC });

    const persistentDataVolume = new ec2.CfnVolume(this, 'PersistentDataVolume', {
      availabilityZone: publicSubnetSelection.subnets[0].availabilityZone,
      size: 150,
      volumeType: 'gp3',
      encrypted: true,
      tags: [
        {
          key: 'Name',
          value: 'windows-dev-persistent-data',
        },
      ],
    });

    const launchTemplate = new ec2.CfnLaunchTemplate(this, 'WindowsLaunchTemplate', {
      launchTemplateData: {
        imageId: ami.getImage(this).imageId,
        instanceType: ec2.InstanceType.of(
          ec2.InstanceClass.C8I,
          ec2.InstanceSize.XLARGE2
        ).toString().toLowerCase(),
        keyName: key.keyPairName,
        securityGroupIds: [sg.securityGroupId],
        userData: cdk.Fn.base64(userData.render()),
        instanceMarketOptions: {
          marketType: 'spot',
        },
      },
    });

    const autoScalingGroup = new autoscaling.CfnAutoScalingGroup(this, 'WindowsAutoScalingGroup', {
      minSize: '0',
      maxSize: '1',
      desiredCapacity: '1',
      vpcZoneIdentifier: [publicSubnetSelection.subnetIds[0]],
      launchTemplate: {
        launchTemplateId: launchTemplate.attrLaunchTemplateId,
        version: launchTemplate.attrLatestVersionNumber,
      },
      tags: [
        {
          key: 'PowerScheduleStart',
          value: '08:00',
          propagateAtLaunch: true,
        },
        {
          key: 'PowerScheduleStop',
          value: '23:30',
          propagateAtLaunch: true,
        },
      ],
    });

    const powerManagerFn = new lambda.Function(this, 'PowerManagerFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      timeout: cdk.Duration.seconds(30),
      environment: {
        PERSISTENT_VOLUME_ID: persistentDataVolume.ref,
        ATTACH_DEVICE: '/dev/sdf',
      },
      code: lambda.Code.fromInline(`import datetime
import os
import boto3

autoscaling_client = boto3.client('autoscaling')
ec2_client = boto3.client('ec2')

VOLUME_ID = os.environ.get('PERSISTENT_VOLUME_ID')
ATTACH_DEVICE = os.environ.get('ATTACH_DEVICE', '/dev/sdf')

def parse_hhmm(value):
    parts = value.split(':')
    if len(parts) != 2:
        raise ValueError(f'invalid HH:MM: {value}')
    hour = int(parts[0])
    minute = int(parts[1])
    if hour < 0 or hour > 23 or minute < 0 or minute > 59:
        raise ValueError(f'invalid HH:MM: {value}')
    return (hour * 60) + minute

def should_be_running(now_minutes, start_minutes, stop_minutes):
    if start_minutes == stop_minutes:
        return True
    if start_minutes < stop_minutes:
        return start_minutes <= now_minutes < stop_minutes
    return now_minutes >= start_minutes or now_minutes < stop_minutes

def tag_map(tags):
    result = {}
    for t in tags or []:
        result[t['Key']] = t['Value']
    return result

def ensure_volume_attached(instance_id):
  if not VOLUME_ID:
    return

  response = ec2_client.describe_volumes(VolumeIds=[VOLUME_ID])
  volumes = response.get('Volumes', [])
  if not volumes:
    print('Persistent volume not found')
    return

  attachments = volumes[0].get('Attachments', [])
  if attachments:
    attached_instance = attachments[0].get('InstanceId')
    state = attachments[0].get('State')
    if attached_instance == instance_id and state in ('attaching', 'attached'):
      return
    print(f'Volume {VOLUME_ID} currently attached to {attached_instance} ({state}), skip')
    return

  print(f'Attaching volume {VOLUME_ID} to instance {instance_id}')
  ec2_client.attach_volume(
    Device=ATTACH_DEVICE,
    InstanceId=instance_id,
    VolumeId=VOLUME_ID,
  )

def handler(event, context):
    now = datetime.datetime.now(datetime.timezone.utc)
    now_minutes = (now.hour * 60) + now.minute
  paginator = autoscaling_client.get_paginator('describe_auto_scaling_groups')

    for page in paginator.paginate():
        for group in page.get('AutoScalingGroups', []):
            tags = tag_map(group.get('Tags', []))
            start = tags.get('PowerScheduleStart')
            stop = tags.get('PowerScheduleStop')
            if not start or not stop:
                continue

            try:
                start_minutes = parse_hhmm(start)
                stop_minutes = parse_hhmm(stop)
            except Exception:
                print(f"Skipping {group['AutoScalingGroupName']} due to invalid tags")
                continue

            target_desired = 1 if should_be_running(now_minutes, start_minutes, stop_minutes) else 0
            current_desired = group.get('DesiredCapacity', 0)
            group_name = group['AutoScalingGroupName']

            if current_desired != target_desired:
              print(f'Updating {group_name} desired {current_desired} -> {target_desired}')
              autoscaling_client.set_desired_capacity(
                AutoScalingGroupName=group_name,
                    DesiredCapacity=target_desired,
                    HonorCooldown=False,
                )

            if target_desired == 1:
              refreshed = autoscaling_client.describe_auto_scaling_groups(
                AutoScalingGroupNames=[group_name]
              ).get('AutoScalingGroups', [])
              if not refreshed:
                continue

              instances = refreshed[0].get('Instances', [])
              candidate = next(
                (i['InstanceId'] for i in instances if i.get('LifecycleState') in ('InService', 'Pending')),
                None,
              )
              if candidate:
                ensure_volume_attached(candidate)
      `),
    });

    powerManagerFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'autoscaling:DescribeAutoScalingGroups',
          'autoscaling:SetDesiredCapacity',
          'ec2:DescribeVolumes',
          'ec2:AttachVolume',
        ],
        resources: ['*'],
      })
    );

    new events.Rule(this, 'PowerManagerScheduleRule', {
      schedule: events.Schedule.rate(cdk.Duration.minutes(5)),
      targets: [new targets.LambdaFunction(powerManagerFn)],
    });

    new CfnOutput(this, 'AutoScalingGroupName', {
      value: autoScalingGroup.ref,
    });

    new CfnOutput(this, 'PowerManagerFunctionName', {
      value: powerManagerFn.functionName,
    });

    new CfnOutput(this, 'PersistentDataVolumeId', {
      value: persistentDataVolume.ref,
    });
  }
}