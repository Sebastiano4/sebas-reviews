# Auto-sync per sebas-reviews
# Osserva la cartella e committa+pusha automaticamente dopo 60s di inattivita'.
# Avvio: doppio click su auto-sync.bat, oppure: powershell -ExecutionPolicy Bypass -File auto-sync.ps1

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoPath  = Split-Path -Parent $ScriptDir
$DebounceSeconds = 60
$Branch    = "main"

Set-Location $RepoPath

Write-Host "==============================================="
Write-Host " Auto-sync attivo su: $RepoPath"
Write-Host " Ramo:                $Branch"
Write-Host " Debounce:            $DebounceSeconds secondi di inattivita'"
Write-Host " Chiudi questa finestra per disattivare."
Write-Host "==============================================="

$watcher = New-Object System.IO.FileSystemWatcher
$watcher.Path = $RepoPath
$watcher.IncludeSubdirectories = $true
$watcher.EnableRaisingEvents = $true
$watcher.NotifyFilter = [System.IO.NotifyFilters]'FileName,LastWrite,DirectoryName'

$global:lastChange = $null

$action = {
    $path = $Event.SourceEventArgs.FullPath
    # Ignora cartelle che non devono triggerare sync
    if ($path -match '\\\.git\\' -or
        $path -match '\\node_modules\\' -or
        $path -match '\\\.claude\\' -or
        $path -match '\\\.firebase\\' -or
        $path -match '\.log$' -or
        $path -match '\\functions\\\.env') {
        return
    }
    $global:lastChange = Get-Date
}

Register-ObjectEvent $watcher Changed -Action $action | Out-Null
Register-ObjectEvent $watcher Created -Action $action | Out-Null
Register-ObjectEvent $watcher Deleted -Action $action | Out-Null
Register-ObjectEvent $watcher Renamed -Action $action | Out-Null

while ($true) {
    Start-Sleep -Seconds 5
    if ($global:lastChange -ne $null) {
        $elapsed = (Get-Date) - $global:lastChange
        if ($elapsed.TotalSeconds -ge $DebounceSeconds) {
            $global:lastChange = $null
            $status = git -C $RepoPath status --porcelain
            if ([string]::IsNullOrWhiteSpace($status)) {
                continue
            }
            $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
            Write-Host "[$stamp] Modifiche rilevate, eseguo sync..."
            git -C $RepoPath add -A 2>&1 | Out-Null
            $msg = "Auto-sync $stamp"
            git -C $RepoPath commit -m $msg 2>&1 | Out-Null
            $pushResult = git -C $RepoPath push origin $Branch 2>&1
            if ($LASTEXITCODE -eq 0) {
                Write-Host "[$stamp] Push completato."
            } else {
                Write-Host "[$stamp] ERRORE push: $pushResult"
            }
        }
    }
}
