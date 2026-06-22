import * as cdk from 'aws-cdk-lib';
import { Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export class WindowsEc2Stack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const vpc = ec2.Vpc.fromLookup(this, 'DefaultVPC', {
      isDefault: true,
    });

    const sg = new ec2.SecurityGroup(this, 'RDPSecurityGroup', {
      vpc,
      description: 'Allow RDP access',
      allowAllOutbound: true,
    });

    sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(3389), 'Allow RDP from anywhere');

    const key = new ec2.KeyPair(this, 'KeyPair', {
      keyPairName: 'windows-rdp-key',
    });

    const ami = ec2.MachineImage.latestWindows(
      ec2.WindowsVersion.WINDOWS_SERVER_2022_ENGLISH_FULL_BASE
    );

    const ec2LogGroup = new logs.LogGroup(this, 'Ec2UserDataLogGroup', {
      logGroupName: '/ec2/windows-ec2/userdata',
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const ec2InstanceRole = new iam.Role(this, 'WindowsEc2InstanceRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
      ],
    });

    const ec2InstanceProfile = new iam.CfnInstanceProfile(this, 'WindowsEc2InstanceProfile', {
      roles: [ec2InstanceRole.roleName],
    });

    const userData = ec2.UserData.forWindows();
    userData.addCommands(
      '$ErrorActionPreference = "Stop"',
      '$ProgressPreference = "SilentlyContinue"',
      'New-Item -ItemType Directory -Path "C:\\ProgramData\\Amazon\\EC2Launch\\log" -Force | Out-Null',
      '$userDataInstallLog = "C:\\ProgramData\\Amazon\\EC2Launch\\log\\userdata-install.log"',
      'Start-Transcript -Path $userDataInstallLog -Append',
      'trap { Write-Output "User data failed: $($_.Exception.Message)"; try { Stop-Transcript | Out-Null } catch {}; throw }',
      '$cwAgentInstaller = "$env:TEMP\\amazon-cloudwatch-agent.msi"',
      'Invoke-WebRequest -Uri "https://amazoncloudwatch-agent.s3.amazonaws.com/windows/amd64/latest/amazon-cloudwatch-agent.msi" -OutFile $cwAgentInstaller',
      '$cwAgentInstallProcess = Start-Process -FilePath msiexec.exe -ArgumentList "/i", $cwAgentInstaller, "/qn", "/norestart" -Wait -PassThru',
      'if ($cwAgentInstallProcess.ExitCode -notin @(0, 3010, 1641)) { throw "CloudWatch Agent install failed with exit code $($cwAgentInstallProcess.ExitCode)" }',
      '$cwAgentCtl = "C:\\Program Files\\Amazon\\AmazonCloudWatchAgent\\amazon-cloudwatch-agent-ctl.ps1"',
      'if (-not (Test-Path $cwAgentCtl)) { throw "CloudWatch Agent control script not found at $cwAgentCtl" }',
      '$cwAgentConfigPath = "C:\\ProgramData\\Amazon\\AmazonCloudWatchAgent\\amazon-cloudwatch-agent.json"',
      '$vsInstallLog = "C:\\ProgramData\\Amazon\\EC2Launch\\log\\vs-installer.log"',
      '$qtInstallLog = "C:\\ProgramData\\Amazon\\EC2Launch\\log\\qt-installer.log"',
      '$qtInstallErrLog = "C:\\ProgramData\\Amazon\\EC2Launch\\log\\qt-installer.err.log"',
      '$cmakeInstallLog = "C:\\ProgramData\\Amazon\\EC2Launch\\log\\cmake-installer.log"',
      '$cmakeMsiLog = "C:\\ProgramData\\Amazon\\EC2Launch\\log\\cmake-msi.log"',
      '$cwAgentConfig = @"',
      '{',
      '  "agent": {',
      '    "run_as_user": "Administrator"',
      '  },',
      '  "logs": {',
      '    "logs_collected": {',
      '      "files": {',
      '        "collect_list": [',
      '          {',
      '            "file_path": "C:\\\\ProgramData\\\\Amazon\\\\EC2Launch\\\\log\\\\agent.log",',
      `            "log_group_name": "${ec2LogGroup.logGroupName}",`,
      '            "log_stream_name": "{instance_id}/ec2launch-agent",',
      '            "timestamp_format": "%Y-%m-%d %H:%M:%S"',
      '          },',
      '          {',
      '            "file_path": "C:\\\\ProgramData\\\\Amazon\\\\EC2Launch\\\\log\\\\err.log",',
      `            "log_group_name": "${ec2LogGroup.logGroupName}",`,
      '            "log_stream_name": "{instance_id}/ec2launch-err"',
      '          },',
      '          {',
      '            "file_path": "C:\\\\ProgramData\\\\Amazon\\\\EC2-Windows\\\\Launch\\\\Log\\\\UserdataExecution.log",',
      `            "log_group_name": "${ec2LogGroup.logGroupName}",`,
      '            "log_stream_name": "{instance_id}/userdata-legacy"',
      '          },',
      '          {',
      '            "file_path": "C:\\\\ProgramData\\\\Amazon\\\\EC2Launch\\\\log\\\\userdata-install.log",',
      `            "log_group_name": "${ec2LogGroup.logGroupName}",`,
      '            "log_stream_name": "{instance_id}/userdata-install"',
      '          },',
      '          {',
      '            "file_path": "C:\\\\ProgramData\\\\Amazon\\\\EC2Launch\\\\log\\\\vs-installer.log",',
      `            "log_group_name": "${ec2LogGroup.logGroupName}",`,
      '            "log_stream_name": "{instance_id}/vs-installer"',
      '          },',
      '          {',
      '            "file_path": "C:\\\\ProgramData\\\\Amazon\\\\EC2Launch\\\\log\\\\qt-installer.log",',
      `            "log_group_name": "${ec2LogGroup.logGroupName}",`,
      '            "log_stream_name": "{instance_id}/qt-installer"',
      '          },',
      '          {',
      '            "file_path": "C:\\\\ProgramData\\\\Amazon\\\\EC2Launch\\\\log\\\\qt-installer.err.log",',
      `            "log_group_name": "${ec2LogGroup.logGroupName}",`,
      '            "log_stream_name": "{instance_id}/qt-installer-err"',
      '          },',
      '          {',
      '            "file_path": "C:\\\\ProgramData\\\\Amazon\\\\EC2Launch\\\\log\\\\cmake-installer.log",',
      `            "log_group_name": "${ec2LogGroup.logGroupName}",`,
      '            "log_stream_name": "{instance_id}/cmake-installer"',
      '          },',
      '          {',
      '            "file_path": "C:\\\\ProgramData\\\\Amazon\\\\EC2Launch\\\\log\\\\cmake-msi.log",',
      `            "log_group_name": "${ec2LogGroup.logGroupName}",`,
      '            "log_stream_name": "{instance_id}/cmake-msi"',
      '          }',
      '        ]',
      '      }',
      '    }',
      '  }',
      '}',
      '"@',
      '$cwAgentConfig | Out-File -FilePath $cwAgentConfigPath -Encoding ascii -Force',
      '& $cwAgentCtl -a fetch-config -m ec2 -c file:$cwAgentConfigPath -s',
      '$gitInstaller = "$env:TEMP\\GitInstaller.exe"',
      'Invoke-WebRequest -Uri "https://github.com/git-for-windows/git/releases/download/v2.46.2.windows.1/Git-2.46.2-64-bit.exe" -OutFile $gitInstaller',
      'Start-Process -FilePath $gitInstaller -ArgumentList "/VERYSILENT", "/NORESTART" -Wait',
      '$pythonInstaller = "$env:TEMP\\python-installer.exe"',
      'Invoke-WebRequest -Uri "https://www.python.org/ftp/python/3.12.10/python-3.12.10-amd64.exe" -OutFile $pythonInstaller',
      'Start-Process -FilePath $pythonInstaller -ArgumentList "/quiet", "InstallAllUsers=1", "PrependPath=1", "Include_test=0" -Wait',
      '$pythonCmd = "C:\\Program Files\\Python312\\python.exe"',
      'if (-not (Test-Path $pythonCmd)) { $pythonCmd = "python" }',
      'Write-Output "===== Installing aqtinstall (pip) ====="',
      '$pipProcess = Start-Process -FilePath $pythonCmd -ArgumentList "-m", "pip", "install", "--upgrade", "--no-warn-script-location", "pip", "aqtinstall" -RedirectStandardOutput $qtInstallLog -RedirectStandardError $qtInstallErrLog -Wait -PassThru',
      'if ($pipProcess.ExitCode -ne 0) { throw "aqtinstall bootstrap failed with exit code $($pipProcess.ExitCode)" }',
      'Write-Output "===== Installing Qt 6.8.3 MSVC2022 via aqt ====="',
      '$aqtProcess = Start-Process -FilePath $pythonCmd -ArgumentList "-m", "aqt", "install-qt", "windows", "desktop", "6.8.3", "win64_msvc2022_64", "--outputdir", "C:\\Qt" -RedirectStandardOutput $qtInstallLog -RedirectStandardError $qtInstallErrLog -Wait -PassThru',
      'if ($aqtProcess.ExitCode -ne 0) { throw "Qt install via aqt failed with exit code $($aqtProcess.ExitCode)" }',
      '$qtArtifacts = Get-ChildItem -Path "C:\\Qt" -Recurse -File -Include qmake.exe,qtpaths.exe,qt-cmake.bat -ErrorAction SilentlyContinue | Select-Object -First 1',
      'if (-not $qtArtifacts) { throw "Qt install completed but no expected Qt tool (qmake.exe/qtpaths.exe/qt-cmake.bat) was found under C:\\Qt" }',
      'Write-Output "===== Qt installation completed; proceeding to Visual Studio install ====="',
      '$vsInstaller = "$env:TEMP\\vs_community.exe"',
      'Invoke-WebRequest -Uri "https://aka.ms/vs/17/release/vs_community.exe" -OutFile $vsInstaller',
      'Write-Output "===== Starting Visual Studio installation ====="',
      '$vsProcess = Start-Process -FilePath $vsInstaller -ArgumentList "--quiet", "--wait", "--norestart", "--nocache", "--installPath", "C:\\VS2022", "--productId", "Microsoft.VisualStudio.Product.Community", "--add", "Microsoft.VisualStudio.Workload.NativeDesktop", "--includeRecommended" -Wait -PassThru',
      '$vsBootstrapperLogs = Get-ChildItem -Path $env:TEMP -Filter "dd_*" -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 10',
      'foreach ($vsLog in $vsBootstrapperLogs) { Add-Content -Path $vsInstallLog -Value ("===== " + $vsLog.FullName + " ====="); Get-Content -Path $vsLog.FullName -Tail 200 | Add-Content -Path $vsInstallLog }',
      'if ($vsProcess.ExitCode -notin @(0, 3010, 1641)) { throw "Visual Studio install failed with exit code $($vsProcess.ExitCode)" }',
      'if (-not (Test-Path "C:\\VS2022\\Common7\\IDE\\devenv.exe")) { throw "Visual Studio install completed but devenv.exe not found at C:\\VS2022" }',
      '$sevenZipInstaller = "$env:TEMP\\7zip.exe"',
      'Invoke-WebRequest -Uri "https://www.7-zip.org/a/7z2301-x64.exe" -OutFile $sevenZipInstaller',
      'Start-Process -FilePath $sevenZipInstaller -ArgumentList "/S" -Wait',
      '$mpiRuntimeInstaller = "$env:TEMP\\msmpisetup.exe"',
      'Invoke-WebRequest -Uri "https://download.microsoft.com/download/a/e/0/ae002626-9d9d-448d-8197-1ea510e297ce/msmpisetup.exe" -OutFile $mpiRuntimeInstaller',
      'Start-Process -FilePath $mpiRuntimeInstaller -ArgumentList "/quiet", "/norestart" -Wait',
      '$mpiSdkInstaller = "$env:TEMP\\msmpisdk.msi"',
      'Invoke-WebRequest -Uri "https://download.microsoft.com/download/a/e/0/ae002626-9d9d-448d-8197-1ea510e297ce/msmpisdk.msi" -OutFile $mpiSdkInstaller',
      'Start-Process -FilePath msiexec.exe -ArgumentList "/i", $mpiSdkInstaller, "/qn", "/norestart" -Wait',
      '$cmakeInstaller = "$env:TEMP\\cmake-installer.msi"',
      'Invoke-WebRequest -Uri "https://github.com/Kitware/CMake/releases/download/v3.31.6/cmake-3.31.6-windows-x86_64.msi" -OutFile $cmakeInstaller',
      'Write-Output "===== Installing CMake via MSI ====="',
      '$cmakeProcess = Start-Process -FilePath msiexec.exe -ArgumentList "/i", $cmakeInstaller, "/qn", "/norestart", "ALLUSERS=1", "ADD_CMAKE_TO_PATH=System", "/L*V", $cmakeMsiLog -Wait -PassThru',
      'if ($cmakeProcess.ExitCode -notin @(0, 3010, 1641)) { throw "CMake install failed with exit code $($cmakeProcess.ExitCode)" }',
      '$cmakeExePath = $null',
      '$cmakeCandidates = @("C:\\Program Files\\CMake\\bin\\cmake.exe", "C:\\Program Files (x86)\\CMake\\bin\\cmake.exe")',
      'foreach ($candidate in $cmakeCandidates) { if (Test-Path $candidate) { $cmakeExePath = $candidate; break } }',
      'if (-not $cmakeExePath) {',
      '  Write-Output "CMake MSI completed but cmake.exe not found in standard paths. Falling back to portable ZIP."',
      '  $cmakeZip = "$env:TEMP\\cmake-portable.zip"',
      '  Invoke-WebRequest -Uri "https://github.com/Kitware/CMake/releases/download/v3.31.6/cmake-3.31.6-windows-x86_64.zip" -OutFile $cmakeZip',
      '  New-Item -ItemType Directory -Path "C:\\Tools\\CMake" -Force | Out-Null',
      '  Expand-Archive -Path $cmakeZip -DestinationPath "C:\\Tools\\CMake" -Force',
      '  $portableCmake = Get-ChildItem -Path "C:\\Tools\\CMake" -Filter cmake.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1',
      '  if ($portableCmake) { $cmakeExePath = $portableCmake.FullName }',
      '}',
      'if (-not $cmakeExePath) { throw "CMake install completed but cmake.exe was not found after MSI and fallback ZIP installation" }',
      '$cmakeBinDir = Split-Path -Path $cmakeExePath -Parent',
      '$machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")',
      'if ($machinePath -notlike "*$cmakeBinDir*") { [Environment]::SetEnvironmentVariable("Path", "$machinePath;$cmakeBinDir", "Machine") }',
      'Write-Output "CMake executable found at: $cmakeExePath"',
      'Add-Content -Path $cmakeInstallLog -Value "CMake executable found at: $cmakeExePath"',
      '$ninjaZip = "$env:TEMP\\ninja-win.zip"',
      'Invoke-WebRequest -Uri "https://github.com/ninja-build/ninja/releases/download/v1.12.1/ninja-win.zip" -OutFile $ninjaZip',
      'New-Item -ItemType Directory -Path "C:\\Tools\\Ninja" -Force | Out-Null',
      'Expand-Archive -Path $ninjaZip -DestinationPath "C:\\Tools\\Ninja" -Force',
      '$machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")',
      'if ($machinePath -notlike "*C:\\Tools\\Ninja*") { [Environment]::SetEnvironmentVariable("Path", "$machinePath;C:\\Tools\\Ninja", "Machine") }',
      '$libPackArchive = "$env:TEMP\\LibPack-1.1.0-v3.1.1.3-Release.7z"',
      'Invoke-WebRequest -Uri "https://github.com/FreeCAD/FreeCAD-LibPack/releases/download/3.1.1.3/LibPack-1.1.0-v3.1.1.3-Release.7z" -OutFile $libPackArchive',
      'New-Item -ItemType Directory -Path "C:\\FreeCADLibPack" -Force | Out-Null',
      'Start-Process -FilePath "C:\\Program Files\\7-Zip\\7z.exe" -ArgumentList "x", $libPackArchive, "-oC:\\LibPack-1.1.0-v3.1.1.3-Release", "-y" -Wait',
      'Write-Output "Git, Python 3, Microsoft MPI, CMake, Ninja, Visual Studio 2022, Qt 6.8.3, and FreeCAD LibPack installed."',
      'Stop-Transcript'
    );

    const publicSubnetSelection = vpc.selectSubnets({ subnetType: ec2.SubnetType.PUBLIC });

    const launchTemplate = new ec2.CfnLaunchTemplate(this, 'WindowsLaunchTemplate', {
      launchTemplateData: {
        imageId: ami.getImage(this).imageId,
        instanceType: ec2.InstanceType.of(ec2.InstanceClass.C8I, ec2.InstanceSize.XLARGE).toString().toLowerCase(),
        keyName: key.keyPairName,
        iamInstanceProfile: {
          name: ec2InstanceProfile.ref,
        },
        securityGroupIds: [sg.securityGroupId],
        userData: cdk.Fn.base64(userData.render()),
        blockDeviceMappings: [
          {
            deviceName: '/dev/sda1',
            ebs: {
              volumeSize: 150,
              volumeType: 'gp3',
              deleteOnTermination: false,
            },
          },
        ],
      },
    });

    const windowsInstance = new ec2.CfnInstance(this, 'WindowsInstance', {
      subnetId: publicSubnetSelection.subnetIds[0],
      launchTemplate: {
        launchTemplateId: launchTemplate.attrLaunchTemplateId,
        version: launchTemplate.attrLatestVersionNumber,
      },
      tags: [
        {
          key: 'PowerScheduleStart',
          value: '10:00',
        },
        {
          key: 'PowerScheduleStop',
          value: '18:30',
        },
      ],
    });

    const powerManagerFn = new lambda.Function(this, 'PowerManagerFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      timeout: cdk.Duration.seconds(30),
      environment: {
        INSTANCE_ID: windowsInstance.ref,
      },
      code: lambda.Code.fromInline(`import datetime
import os
import boto3

ec2_client = boto3.client('ec2')
INSTANCE_ID = os.environ.get('INSTANCE_ID')
AEST = datetime.timezone(datetime.timedelta(hours=10), name='AEST')

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

def handler(event, context):
    if not INSTANCE_ID:
        print('INSTANCE_ID not configured')
        return

    now = datetime.datetime.now(AEST)
    now_minutes = (now.hour * 60) + now.minute

    response = ec2_client.describe_instances(InstanceIds=[INSTANCE_ID])
    reservations = response.get('Reservations', [])
    if not reservations or not reservations[0].get('Instances'):
        print('Instance not found')
        return

    instance = reservations[0]['Instances'][0]
    tags = tag_map(instance.get('Tags', []))
    start = tags.get('PowerScheduleStart')
    stop = tags.get('PowerScheduleStop')
    if not start or not stop:
        print('Schedule tags not found')
        return

    try:
        start_minutes = parse_hhmm(start)
        stop_minutes = parse_hhmm(stop)
    except Exception:
        print('Invalid schedule tags')
        return

    target_running = should_be_running(now_minutes, start_minutes, stop_minutes)
    state = instance.get('State', {}).get('Name')

    if target_running and state == 'stopped':
        print(f'Starting instance {INSTANCE_ID}')
        ec2_client.start_instances(InstanceIds=[INSTANCE_ID])
    elif not target_running and state == 'running':
        print(f'Stopping instance {INSTANCE_ID}')
        ec2_client.stop_instances(InstanceIds=[INSTANCE_ID])
      `),
    });

    powerManagerFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'ec2:DescribeInstances',
          'ec2:StartInstances',
          'ec2:StopInstances',
        ],
        resources: ['*'],
      })
    );

    new events.Rule(this, 'PowerManagerScheduleRule', {
      schedule: events.Schedule.rate(cdk.Duration.minutes(5)),
      targets: [new targets.LambdaFunction(powerManagerFn)],
    });

    new CfnOutput(this, 'InstanceId', {
      value: windowsInstance.ref,
    });

    new CfnOutput(this, 'PowerManagerFunctionName', {
      value: powerManagerFn.functionName,
    });
  }
}
