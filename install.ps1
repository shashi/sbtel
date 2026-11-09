# sbtel installer for Windows PowerShell 5.1+ and PowerShell 7. docs/DESIGN.md section 9.3 is the contract.
#
#   irm https://raw.githubusercontent.com/shashi/sbtel/main/install.ps1 | iex
#
# Environment:
#   SBTEL_INSTALL_DIR  where to put sbtel.exe          (default: $env:LOCALAPPDATA\Programs\sbtel)
#   SBTEL_VERSION      a release tag such as v0.2.0     (default: the latest release)
#   SBTEL_BASE_URL     where the release files live     (overrides SBTEL_VERSION)
#
# It downloads sbtel_windows_<arch>.exe and checksums.txt, checks the SHA256, and installs only when the
# checksum matches. Failures never close the window: under `iex` they are reported and the script stops.

function Install-Sbtel {
    $ErrorActionPreference = 'Stop'
    $ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest is many times faster without the progress bar

    # Windows PowerShell 5.1 may default to TLS 1.0; GitHub needs 1.2.
    try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }

    # 32-bit PowerShell on 64-bit Windows reports x86 and puts the real architecture in PROCESSOR_ARCHITEW6432.
    $rawArch = $env:PROCESSOR_ARCHITEW6432
    if (-not $rawArch) { $rawArch = $env:PROCESSOR_ARCHITECTURE }
    switch ($rawArch) {
        'AMD64' { $arch = 'amd64' }
        'ARM64' { $arch = 'arm64' }
        default { throw "sbtel install: unsupported architecture: '$rawArch' (release builds exist for AMD64 and ARM64)" }
    }
    $asset = "sbtel_windows_$arch.exe"

    if ($env:SBTEL_BASE_URL) {
        $base = $env:SBTEL_BASE_URL.TrimEnd('/')
    } elseif ($env:SBTEL_VERSION) {
        $base = "https://github.com/shashi/sbtel/releases/download/$($env:SBTEL_VERSION)"
    } else {
        $base = 'https://github.com/shashi/sbtel/releases/latest/download'
    }

    if ($env:SBTEL_INSTALL_DIR) {
        $dir = $env:SBTEL_INSTALL_DIR
    } elseif ($env:LOCALAPPDATA) {
        $dir = Join-Path $env:LOCALAPPDATA 'Programs\sbtel'
    } else {
        throw 'sbtel install: LOCALAPPDATA is not set; set SBTEL_INSTALL_DIR'
    }
    $target = Join-Path $dir 'sbtel.exe'

    $tmp = Join-Path ([IO.Path]::GetTempPath()) ('sbtel-install-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $tmp -Force | Out-Null
    try {
        Write-Host "sbtel install: downloading $base/$asset"
        foreach ($name in @($asset, 'checksums.txt')) {
            try {
                Invoke-WebRequest -UseBasicParsing -Uri "$base/$name" -OutFile (Join-Path $tmp $name)
            } catch {
                throw "sbtel install: download failed: $base/$name ($($_.Exception.Message))"
            }
        }

        # sha256sum format: "<64 hex>  <name>" (a "*" before the name marks binary mode).
        $want = $null
        foreach ($line in Get-Content -LiteralPath (Join-Path $tmp 'checksums.txt')) {
            $f = $line.Trim() -split '\s+'
            if ($f.Count -ge 2 -and ($f[1] -eq $asset -or $f[1] -eq "*$asset")) { $want = $f[0].ToLowerInvariant(); break }
        }
        if (-not $want) { throw "sbtel install: checksums.txt has no line for $asset" }
        $got = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $tmp $asset)).Hash.ToLowerInvariant()
        if ($got -ne $want) { throw "sbtel install: checksum mismatch for $asset (expected $want, got $got); nothing installed" }

        try { New-Item -ItemType Directory -Path $dir -Force | Out-Null } catch { throw "sbtel install: cannot create ${dir}: $($_.Exception.Message)" }
        $part = Join-Path $dir '.sbtel.exe.part'
        $old = Join-Path $dir '.sbtel.exe.old'
        try {
            Copy-Item -LiteralPath (Join-Path $tmp $asset) -Destination $part -Force
            # A running sbtel.exe (the viewer server) cannot be overwritten, but it can be renamed.
            if (Test-Path -LiteralPath $old) { Remove-Item -LiteralPath $old -Force -ErrorAction SilentlyContinue }
            if (Test-Path -LiteralPath $target) { Move-Item -LiteralPath $target -Destination $old -Force }
            Move-Item -LiteralPath $part -Destination $target -Force
            if (Test-Path -LiteralPath $old) { Remove-Item -LiteralPath $old -Force -ErrorAction SilentlyContinue }
        } catch {
            Remove-Item -LiteralPath $part -Force -ErrorAction SilentlyContinue
            throw "sbtel install: cannot install to ${target}: $($_.Exception.Message)"
        }
    } finally {
        Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
    }

    try { & $target version } catch { throw "sbtel install: installed $target, but it does not run: $($_.Exception.Message)" }
    if ($LASTEXITCODE -ne 0) { throw "sbtel install: installed $target, but 'sbtel version' exited $LASTEXITCODE" }
    Write-Host "sbtel install: installed $target"

    # Add the directory to the *user* PATH if it is missing.
    $norm = { param($p) $p.Trim().TrimEnd('\', '/').ToLowerInvariant() }
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $entries = @()
    if ($userPath) { $entries = $userPath -split ';' | Where-Object { $_.Trim() } }
    $onUserPath = @($entries | Where-Object { (& $norm $_) -eq (& $norm $dir) }).Count -gt 0
    if (-not $onUserPath) {
        $new = (@($entries) + $dir) -join ';'
        [Environment]::SetEnvironmentVariable('Path', $new, 'User')
        $env:Path = "$env:Path;$dir"
        Write-Host ''
        Write-Host "Added $dir to your user PATH. Open a new terminal to use sbtel there."
        Write-Host ''
    }
}

try {
    Install-Sbtel
} catch {
    $msg = $_.Exception.Message
    if ($msg -notlike 'sbtel install:*') { $msg = "sbtel install: $msg" }
    [Console]::Error.WriteLine($msg)
    # Run as a file (powershell -File install.ps1): exit non-zero. Under `irm | iex`, exiting would close
    # the user's window, so stop here instead.
    if ($MyInvocation.MyCommand.Path) { exit 1 }
}
