[CmdletBinding()]
param(
    [ValidateSet('Preflight', 'Backup', 'Reset', 'RestoreAuth', 'RestorePublic', 'Verify', 'All')]
    [string]$Mode = 'Preflight',
    [string]$RepositoryRoot,
    [string]$EnvFile = '.env.production.local',
    [string]$ProjectRef,
    [string]$Region = 'ap-south-1',
    [ValidateRange(0, 9)][int]$PoolerIndex = 1,
    [string]$PoolerHost,
    [string]$LocalDbContainer,
    [string]$BackupDirectory,
    [string]$ConfirmProjectRef,
    [string]$SupabaseCli
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$MasterTables = @(
    'customers', 'customer_contacts', 'customer_bank_accounts', 'customer_farms',
    'transport_staffs', 'transport_staff_contacts',
    'transport_staff_bank_accounts', 'transport_staff_plates'
)
$EmptyTables = @(
    'rubber_bills', 'rubber_bill_items', 'rubber_exports',
    'report_batches', 'money_transfers'
)

function Step([string]$Message) {
    Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Run {
    param([string]$File, [string[]]$ArgumentList, [switch]$Capture)
    if ($Capture) {
        $output = @(& $File @ArgumentList 2>&1)
        if ($LASTEXITCODE -ne 0) { throw "$File failed (exit $LASTEXITCODE)" }
        return @($output | ForEach-Object { "$_" } | Where-Object { $_ })
    }
    & $File @ArgumentList
    if ($LASTEXITCODE -ne 0) { throw "$File failed (exit $LASTEXITCODE)" }
}

function Run-ToFile {
    param([string]$File, [string[]]$ArgumentList, [string]$Destination)
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $File
    $info.UseShellExecute = $false
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.CreateNoWindow = $true
    foreach ($arg in $ArgumentList) { [void]$info.ArgumentList.Add($arg) }

    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $info
    if (-not $process.Start()) { throw "Cannot start $File" }
    $errorTask = $process.StandardError.ReadToEndAsync()
    $stream = [IO.File]::Create($Destination)
    try { $process.StandardOutput.BaseStream.CopyTo($stream) }
    finally { $stream.Dispose() }
    $process.WaitForExit()
    $errorText = $errorTask.GetAwaiter().GetResult()
    if ($process.ExitCode -ne 0) {
        Remove-Item -LiteralPath $Destination -Force -ErrorAction SilentlyContinue
        throw "$File failed (exit $($process.ExitCode)): $errorText"
    }
    if ($errorText.Trim()) { Write-Warning $errorText.Trim() }
}

function Read-Env([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "ไม่พบ environment file: $Path"
    }
    $values = @{}
    foreach ($line in Get-Content -LiteralPath $Path -Encoding UTF8) {
        if ($line -notmatch '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$') { continue }
        $value = $Matches[2].Trim()
        if ($value.Length -ge 2 -and (
            ($value.StartsWith('"') -and $value.EndsWith('"')) -or
            ($value.StartsWith("'") -and $value.EndsWith("'"))
        )) { $value = $value.Substring(1, $value.Length - 2) }
        $values[$Matches[1]] = $value
    }
    return $values
}

function Remote-Sql([string]$Sql) {
    return @(Run docker @(
        'exec', '-e', 'PGPASSWORD', $script:Container,
        'psql', $script:RemoteConnection, '-v', 'ON_ERROR_STOP=1', '-Atc', $Sql
    ) -Capture)
}

function Local-Sql([string]$Sql) {
    return @(Run docker @(
        'exec', $script:Container, 'psql', '-U', 'postgres', '-d', 'postgres',
        '-v', 'ON_ERROR_STOP=1', '-Atc', $Sql
    ) -Capture)
}

function Migration-Files-Hash {
    $files = @(Get-ChildItem -LiteralPath (Join-Path $script:Root 'supabase\migrations') `
        -File -Filter '*.sql' | Sort-Object Name)
    if (-not $files) { throw 'ไม่พบ migration files' }
    $text = ($files | ForEach-Object {
        "$($_.Name)|$((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash)"
    }) -join "`n"
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        return [Convert]::ToHexString(
            $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($text))
        )
    }
    finally { $sha.Dispose() }
}

function Auth-State {
    return @(Remote-Sql @"
select 'users|'||count(*)||'|'||
 coalesce(md5(string_agg(id::text,',' order by id::text)),'')||'|'||
 coalesce(md5(string_agg(to_jsonb(x)::text,'' order by id::text)),'')
from auth.users x
union all
select 'identities|'||count(*)||'|'||
 coalesce(md5(string_agg(id::text,',' order by id::text)),'')||'|'||
 coalesce(md5(string_agg(to_jsonb(x)::text,'' order by id::text)),'')
from auth.identities x
union all select 'sessions|'||count(*) from auth.sessions
union all select 'refresh_tokens|'||count(*) from auth.refresh_tokens
union all select 'schema_migrations|'||count(*) from auth.schema_migrations;
"@)
}

function Bridge-State {
    return @(Remote-Sql @"
select 'profiles|'||count(*)||'|'||
 coalesce(md5(string_agg(id::text,',' order by id::text)),'')||'|'||
 coalesce(md5(string_agg(to_jsonb(x)::text,'' order by id::text)),'')
from public.profiles x
union all
select 'locations|'||count(*)||'|'||
 coalesce(md5(string_agg(id::text,',' order by id::text)),'')||'|'||
 coalesce(md5(string_agg(to_jsonb(x)::text,'' order by id::text)),'')
from public.locations x
union all
select 'user_locations|'||count(*)||'|'||
 coalesce(md5(string_agg(id::text,',' order by id::text)),'')||'|'||
 coalesce(md5(string_agg(to_jsonb(x)::text,'' order by id::text)),'')
from public.user_locations x;
"@)
}

function Master-Sql {
    return (($MasterTables | ForEach-Object {
        "select '$_|'||count(*)||'|'||coalesce(md5(string_agg(to_jsonb(x)::text,'' order by id::text)),'') from public.$_ x"
    }) -join ' union all ')
}

function Preflight {
    Step 'Preflight แบบ read-only'
    $git = @(Run git @('-C', $script:Root, 'rev-parse', 'HEAD') -Capture)[0]
    return [ordered]@{
        createdAtUtc = [DateTime]::UtcNow.ToString('o')
        projectRef = $script:ResolvedProjectRef
        poolerHost = $script:ResolvedPoolerHost
        localDbContainer = $script:Container
        gitCommit = $git
        migrationFilesHash = Migration-Files-Hash
        authState = @(Auth-State)
        bridgeState = @(Bridge-State)
        localMasterState = @(Local-Sql (Master-Sql))
        localMigrationState = @(Local-Sql "select count(*)||'|latest='||max(version) from supabase_migrations.schema_migrations;")
        remoteMigrationState = @(Remote-Sql "select count(*)||'|latest='||max(version) from supabase_migrations.schema_migrations;")
    }
}

function Dump {
    param([string]$Name, [string[]]$PgDumpArguments, [switch]$Local)
    $dockerArgs = @('exec')
    if (-not $Local) { $dockerArgs += @('-e', 'PGPASSWORD') }
    $dockerArgs += @($script:Container, 'pg_dump')
    if ($Local) { $dockerArgs += @('-U', 'postgres', '-d', 'postgres') }
    else { $dockerArgs += $script:RemoteConnection }
    $dockerArgs += $PgDumpArguments
    Run-ToFile docker $dockerArgs (Join-Path $script:BackupPath $Name)
}

function Filter-Auth-Dump {
    $source = Join-Path $script:BackupPath 'auth-data.sql'
    $target = Join-Path $script:BackupPath 'auth-data-restorable.sql'
    $reader = [IO.StreamReader]::new($source, [Text.Encoding]::UTF8, $true)
    $writer = [IO.StreamWriter]::new($target, $false, [Text.UTF8Encoding]::new($false))
    $skip = $false
    try {
        while (($line = $reader.ReadLine()) -ne $null) {
            if (-not $skip -and $line.StartsWith('COPY auth.schema_migrations ')) {
                $skip = $true
                continue
            }
            if ($skip) {
                if ($line -eq '\.') { $skip = $false }
                continue
            }
            $writer.WriteLine($line)
        }
    }
    finally { $reader.Dispose(); $writer.Dispose() }
    if ($skip) { throw 'auth.schema_migrations COPY block ไม่สมบูรณ์' }
}

function Write-Json([string]$Path, [object]$Value) {
    [IO.File]::WriteAllText(
        $Path,
        (($Value | ConvertTo-Json -Depth 20) + [Environment]::NewLine),
        [Text.UTF8Encoding]::new($false)
    )
}

function Backup([object]$Receipt) {
    if (-not $script:BackupPath) {
        $script:BackupPath = Join-Path ([IO.Path]::GetTempPath()) `
            ('lanflow-cloud-before-public-replace-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
    }
    if (Test-Path -LiteralPath $script:BackupPath) {
        throw "Backup directory มีอยู่แล้ว: $($script:BackupPath)"
    }
    [void](New-Item -ItemType Directory -Path $script:BackupPath)
    Step "Backup ไปที่ $($script:BackupPath)"

    $common = @('--no-owner', '--no-privileges', '--no-comments')
    Dump 'auth-schema.sql' ($common + @('--schema=auth', '--schema-only'))
    Dump 'auth-data.sql' ($common + @('--schema=auth', '--data-only'))
    Dump 'public-schema.sql' ($common + @('--schema=public', '--schema-only'))
    Dump 'public-data.sql' ($common + @('--schema=public', '--data-only'))
    Dump 'auth-bridge-data.sql' ($common + @(
        '--data-only', '--column-inserts',
        '--table=public.profiles', '--table=public.locations',
        '--table=public.user_locations'
    ))
    Dump 'migration-history.sql' ($common + @(
        '--data-only',
        '--table=supabase_migrations.schema_migrations'
    ))
    $masterArgs = $common + @('--data-only')
    foreach ($table in $MasterTables) { $masterArgs += "--table=public.$table" }
    Dump 'local-master-data.sql' $masterArgs -Local
    Filter-Auth-Dump
    Write-Json (Join-Path $script:BackupPath 'preflight.json') $Receipt

    $hashes = [ordered]@{}
    foreach ($file in Get-ChildItem -LiteralPath $script:BackupPath -File | Sort-Object Name) {
        $hashes[$file.Name] = (Get-FileHash $file.FullName -Algorithm SHA256).Hash
    }
    $manifest = [ordered]@{
        formatVersion = 1
        projectRef = $script:ResolvedProjectRef
        createdAtUtc = [DateTime]::UtcNow.ToString('o')
        preflight = $Receipt
        files = $hashes
    }
    Write-Json (Join-Path $script:BackupPath 'manifest.json') $manifest
    return $manifest
}

function Manifest {
    if (-not $script:BackupPath) { throw 'ต้องระบุ -BackupDirectory' }
    $path = Join-Path $script:BackupPath 'manifest.json'
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "ไม่พบ manifest: $path"
    }
    return (Get-Content $path -Raw -Encoding UTF8 | ConvertFrom-Json)
}

function Check-Backup([object]$Manifest) {
    if ($Manifest.projectRef -ne $script:ResolvedProjectRef) {
        throw 'Project ref ของ backup ไม่ตรง target'
    }
    foreach ($property in $Manifest.files.PSObject.Properties) {
        $path = Join-Path $script:BackupPath $property.Name
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
            throw "ไฟล์ backup หาย: $($property.Name)"
        }
        if ((Get-FileHash $path -Algorithm SHA256).Hash -ne $property.Value) {
            throw "SHA-256 ไม่ตรง: $($property.Name)"
        }
    }
    if ((Migration-Files-Hash) -ne $Manifest.preflight.migrationFilesHash) {
        throw 'Migration files เปลี่ยนหลัง backup กรุณา backup ใหม่'
    }
}

function Confirm-Target {
    if ($ConfirmProjectRef -cne $script:ResolvedProjectRef) {
        throw "ต้องระบุ -ConfirmProjectRef $($script:ResolvedProjectRef) หลังได้รับอนุญาตให้ล้าง production"
    }
}

function Assert-State([object[]]$Expected, [object[]]$Actual, [string]$Label) {
    $expectedLines = @($Expected | ForEach-Object { "$_" } | Sort-Object)
    $actualLines = @($Actual | ForEach-Object { "$_" } | Sort-Object)
    $diff = @(Compare-Object $expectedLines $actualLines)
    if ($diff) { throw "$Label ไม่ตรง manifest:`n$($diff | Out-String)" }
}

function Supabase-Command {
    if ($SupabaseCli) {
        return @{ File = (Resolve-Path $SupabaseCli).Path; Prefix = @() }
    }
    $bundled = if ($env:APPDATA) {
        Join-Path $env:APPDATA 'npm\node_modules\supabase\node_modules\@supabase\cli-windows-x64\bin\supabase-go.exe'
    }
    if ($bundled -and (Test-Path $bundled)) {
        return @{ File = $bundled; Prefix = @() }
    }
    $command = Get-Command supabase -ErrorAction SilentlyContinue
    if ($command) { return @{ File = $command.Source; Prefix = @() } }
    $npx = Get-Command npx.cmd -ErrorAction SilentlyContinue
    if ($npx) { return @{ File = $npx.Source; Prefix = @('supabase') } }
    throw 'ไม่พบ Supabase CLI'
}

function Reset-Cloud([object]$Manifest) {
    Confirm-Target
    Check-Backup $Manifest
    $cli = Supabase-Command
    $escaped = [Uri]::EscapeDataString($script:DbPassword)
    $url = "postgresql://postgres.$($script:ResolvedProjectRef):$escaped@$($script:ResolvedPoolerHost):5432/postgres?sslmode=require&connect_timeout=20"
    try {
        Step 'Reset Cloud และ replay migrations'
        Run $cli.File (@($cli.Prefix) + @(
            'db', 'reset', '--db-url', $url, '--no-seed', '--yes'
        ))
    }
    finally { $url = $null; $escaped = $null }
}

function Restore-Auth([object]$Manifest) {
    Confirm-Target
    Check-Backup $Manifest
    $current = @(Auth-State)
    $userLine = @($current | Where-Object { $_ -like 'users|*' })[0]
    $identityLine = @($current | Where-Object { $_ -like 'identities|*' })[0]
    if ($userLine -notlike 'users|0|*' -or $identityLine -notlike 'identities|0|*') {
        Assert-State $Manifest.preflight.authState $current 'Cloud Auth'
        Write-Host 'Auth ตรง manifest อยู่แล้ว ข้าม restore' -ForegroundColor Green
        return
    }

    Step 'Restore Auth โดยคง auth.schema_migrations'
    $source = Join-Path $script:BackupPath 'auth-data-restorable.sql'
    Run docker @('cp', $source, "$($script:Container):/tmp/lanflow_auth_data.sql")
    Run docker @(
        'exec', '-e', 'PGPASSWORD', $script:Container,
        'psql', $script:RemoteConnection, '-v', 'ON_ERROR_STOP=1',
        '--single-transaction', '-f', '/tmp/lanflow_auth_data.sql'
    )
    Assert-State $Manifest.preflight.authState @(Auth-State) 'Auth หลัง restore'
}

function Restore-Public([object]$Manifest) {
    Confirm-Target
    Check-Backup $Manifest
    Assert-State $Manifest.preflight.authState @(Auth-State) 'Auth ก่อน restore public'
    Step 'Restore profile/location bridge และ local master'

    Run docker @('cp', (Join-Path $script:BackupPath 'auth-bridge-data.sql'),
        "$($script:Container):/tmp/lanflow_bridge.sql")
    Run docker @('cp', (Join-Path $script:BackupPath 'local-master-data.sql'),
        "$($script:Container):/tmp/lanflow_master.sql")

    $pre = @"
SET session_replication_role=replica;
TRUNCATE TABLE public.customers, public.transport_staffs, public.rubber_bills RESTART IDENTITY CASCADE;
DELETE FROM public.user_locations;
DELETE FROM public.locations;
DELETE FROM public.profiles;
"@
    $post = @"
SET session_replication_role=origin;
INSERT INTO public.dashboard_branch_snapshots (location_id)
SELECT id FROM public.locations WHERE is_active=true
ON CONFLICT (location_id) DO NOTHING;
"@
    Run docker @(
        'exec', '-e', 'PGPASSWORD', $script:Container,
        'psql', $script:RemoteConnection, '-v', 'ON_ERROR_STOP=1',
        '--single-transaction', '-q',
        '-c', $pre, '-f', '/tmp/lanflow_bridge.sql',
        '-f', '/tmp/lanflow_master.sql', '-c', $post
    )
}

function Verify([object]$Manifest) {
    Check-Backup $Manifest
    Step 'Verify Auth, master hashes, migrations, RLS และธุรกรรม'
    Assert-State $Manifest.preflight.authState @(Auth-State) 'Auth'
    Assert-State $Manifest.preflight.bridgeState @(Bridge-State) 'Profile/location bridge'
    Assert-State $Manifest.preflight.localMasterState @(Remote-Sql (Master-Sql)) 'Master data'
    Assert-State $Manifest.preflight.localMigrationState `
        @(Remote-Sql "select count(*)||'|latest='||max(version) from supabase_migrations.schema_migrations;") `
        'Migrations'

    $rlsDisabled = @(Remote-Sql "select tablename from pg_tables where schemaname='public' and rowsecurity=false order by tablename;")
    if ($rlsDisabled) { throw "พบตารางที่ปิด RLS: $($rlsDisabled -join ', ')" }

    $emptySql = (($EmptyTables | ForEach-Object {
        "select '$_|'||count(*) from public.$_"
    }) -join ' union all ')
    $emptyState = @(Remote-Sql $emptySql)
    $notEmpty = @($emptyState | Where-Object { $_ -notlike '*|0' })
    if ($notEmpty) { throw "พบ transaction data: $($notEmpty -join ', ')" }

    $receipt = [ordered]@{
        verifiedAtUtc = [DateTime]::UtcNow.ToString('o')
        projectRef = $script:ResolvedProjectRef
        backupDirectory = $script:BackupPath
        authState = @(Auth-State)
        bridgeState = @(Bridge-State)
        masterState = @(Remote-Sql (Master-Sql))
        migrationState = @(Remote-Sql "select count(*)||'|latest='||max(version) from supabase_migrations.schema_migrations;")
        publicTableCount = [int]@(Remote-Sql "select count(*) from pg_tables where schemaname='public';")[0]
        publicPolicyCount = [int]@(Remote-Sql "select count(*) from pg_policies where schemaname='public';")[0]
        rlsDisabled = @()
        transactionState = $emptyState
    }
    Write-Json (Join-Path $script:BackupPath 'verification.json') $receipt
    Write-Host 'VERIFY_OK' -ForegroundColor Green
    return $receipt
}

$script:Root = if ($RepositoryRoot) {
    (Resolve-Path -LiteralPath $RepositoryRoot).Path
}
else {
    (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..\..\..')).Path
}
$envPath = if ([IO.Path]::IsPathRooted($EnvFile)) { $EnvFile }
else { Join-Path $script:Root $EnvFile }
$dotenv = Read-Env $envPath
if (-not $dotenv['SUPABASE_DB_PASSWORD']) { throw 'SUPABASE_DB_PASSWORD ไม่มีค่า' }
if (-not $ProjectRef) {
    if ($dotenv['NEXT_PUBLIC_SUPABASE_URL'] -notmatch '^https://([a-z0-9]+)\.supabase\.co/?$') {
        throw 'อ่าน project ref ไม่ได้ กรุณาระบุ -ProjectRef'
    }
    $ProjectRef = $Matches[1]
}

$script:ResolvedProjectRef = $ProjectRef
$script:ResolvedPoolerHost = if ($PoolerHost) { $PoolerHost }
else { "aws-$PoolerIndex-$Region.pooler.supabase.com" }
$script:DbPassword = $dotenv['SUPABASE_DB_PASSWORD']
$env:PGPASSWORD = $script:DbPassword

if ($LocalDbContainer) { $script:Container = $LocalDbContainer }
else {
    $containers = @(Run docker @('ps', '--format', '{{.Names}}') -Capture |
        Where-Object { $_ -match '^supabase_db_' })
    if ($containers.Count -ne 1) {
        throw "ต้องระบุ -LocalDbContainer; พบ: $($containers -join ', ')"
    }
    $script:Container = $containers[0]
}
$script:RemoteConnection = "host=$($script:ResolvedPoolerHost) port=5432 dbname=postgres user=postgres.$($script:ResolvedProjectRef) sslmode=require connect_timeout=20 keepalives=1 keepalives_idle=10 keepalives_interval=5 keepalives_count=3"
$script:BackupPath = if ($BackupDirectory) { [IO.Path]::GetFullPath($BackupDirectory) } else { $null }

Write-Host "Mode: $Mode"
Write-Host "Project ref: $($script:ResolvedProjectRef)"
Write-Host "Pooler: $($script:ResolvedPoolerHost)"
Write-Host "Local DB: $($script:Container)"

try {
    switch ($Mode) {
        Preflight { (Preflight) | ConvertTo-Json -Depth 10 }
        Backup {
            $manifest = Backup (Preflight)
            Write-Host "BACKUP_OK=$($script:BackupPath)" -ForegroundColor Green
            $manifest | ConvertTo-Json -Depth 10
        }
        Reset {
            $manifest = Manifest
            Reset-Cloud $manifest
            Write-Warning "เรียก RestoreAuth จาก $($script:BackupPath) ทันที"
        }
        RestoreAuth {
            $manifest = Manifest
            Restore-Auth $manifest
            Write-Host 'RESTORE_AUTH_OK' -ForegroundColor Green
        }
        RestorePublic {
            $manifest = Manifest
            Restore-Public $manifest
            Write-Host 'RESTORE_PUBLIC_OK' -ForegroundColor Green
        }
        Verify { (Verify (Manifest)) | ConvertTo-Json -Depth 10 }
        All {
            Confirm-Target
            if ($script:BackupPath) { throw 'Mode All ห้ามใช้ BackupDirectory เก่า' }
            $manifest = Backup (Preflight)
            Write-Host "BACKUP_OK=$($script:BackupPath)" -ForegroundColor Green
            Reset-Cloud $manifest
            Restore-Auth $manifest
            Restore-Public $manifest
            (Verify $manifest) | ConvertTo-Json -Depth 10
            Write-Host "ALL_OK=$($script:BackupPath)" -ForegroundColor Green
        }
    }
}
catch {
    Write-Error $_
    if ($script:BackupPath) {
        Write-Host "RECOVERY_BACKUP=$($script:BackupPath)" -ForegroundColor Yellow
    }
    exit 1
}
finally {
    $env:PGPASSWORD = $null
    $script:DbPassword = $null
}
