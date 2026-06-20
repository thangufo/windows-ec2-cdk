import * as cdk from 'aws-cdk-lib';
import { Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
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
      '$libPackZip = "$env:TEMP\\LibPack-1.1.0-v3.1.1.3-Release.zip"',
      'Invoke-WebRequest -Uri "https://github.com/FreeCAD/FreeCAD-library/releases/download/LibPack-1.1.0-v3.1.1.3-Release/LibPack-1.1.0-v3.1.1.3-Release.zip" -OutFile $libPackZip',
      'New-Item -ItemType Directory -Path "C:\\FreeCADLibPack" -Force | Out-Null',
      'Expand-Archive -Path $libPackZip -DestinationPath "C:\\FreeCADLibPack" -Force',
      'Write-Output "Git, Visual Studio 2022, Qt 6.8.3, and FreeCAD LibPack installed."'
    );

    // EC2 Instance
    const instance = new ec2.Instance(this, 'WindowsInstance', {
      vpc,
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.C7A,
        ec2.InstanceSize.XLARGE
      ),
      machineImage: ami,
      securityGroup: sg,
      keyPair: key,
      userData,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    });

    // Use EC2 Spot instance pricing for this instance
    instance.instance.addPropertyOverride('InstanceMarketOptions', {
      MarketType: 'spot',
    });

    // Output Public IP
    new CfnOutput(this, 'InstancePublicIP', {
      value: instance.instancePublicIp,
    });

    // Output Instance ID
    new CfnOutput(this, 'InstanceId', {
      value: instance.instanceId,
    });
  }
}