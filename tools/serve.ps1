# ============================================================
# serve.ps1 —— 注意实验室本地 HTTPS 静态服务器（TcpListener + SslStream）
# 为什么用 HTTPS：浏览器要求安全上下文才允许摄像头（眼动必需）。
# 证书：自签名（仅本机信任，写入当前用户"受信任的根证书"存储，
#       无需管理员权限；首次运行会弹出一次系统确认框，请点"是"）。
# ============================================================
param([switch]$NoOpen, [switch]$NoTrust)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$port = 8765
$friendly = "AttentionLabHTTPS"

# ---------- 1) 确保证书存在且受信任 ----------
$cert = Get-ChildItem Cert:\CurrentUser\My -ErrorAction SilentlyContinue |
    Where-Object { $_.FriendlyName -eq $friendly } | Select-Object -First 1
if (-not $cert) {
    Write-Host "首次运行：正在创建自签名证书（仅用于 localhost）..."
    $cert = New-SelfSignedCertificate -DnsName "localhost" -FriendlyName $friendly `
        -CertStoreLocation Cert:\CurrentUser\My -NotAfter (Get-Date).AddYears(5)
}
if (-not $NoTrust) {
    $inRoot = Get-ChildItem Cert:\CurrentUser\Root -ErrorAction SilentlyContinue |
        Where-Object { $_.Thumbprint -eq $cert.Thumbprint }
    if (-not $inRoot) {
        Write-Host "正在将证书加入本机受信任存储（若弹出确认框请选择「是」）..."
        $tmp = Join-Path $env:TEMP "alab_cert.cer"
        [IO.File]::WriteAllBytes($tmp, $cert.Export([Security.Cryptography.X509Certificates.X509ContentType]::Cert))
        try { Import-Certificate -FilePath $tmp -CertStoreLocation Cert:\CurrentUser\Root | Out-Null }
        catch { Write-Host "证书信任导入被跳过（浏览器可能提示证书警告，仍可继续）" -ForegroundColor Yellow }
    }
}

# ---------- 2) MIME 表 ----------
$mime = @{
    ".html" = "text/html; charset=utf-8"
    ".js"   = "text/javascript; charset=utf-8"
    ".css"  = "text/css; charset=utf-8"
    ".json" = "application/json; charset=utf-8"
    ".png"  = "image/png"
    ".bmp"  = "image/bmp"
    ".jpg"  = "image/jpeg"
    ".svg"  = "image/svg+xml"
    ".md"   = "text/plain; charset=utf-8"
    ".txt"  = "text/plain; charset=utf-8"
}

# ---------- 3) HTTPS 服务器主循环 ----------
$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $port)
$listener.Start()
Write-Host "==============================================="
Write-Host " 注意实验室本地服务器已启动（HTTPS）"
Write-Host " 地址: https://localhost:$port/index.html"
Write-Host " 摄像头眼动已可在本地址下正常使用"
Write-Host " 关闭此窗口即可停止服务器"
Write-Host "==============================================="
if (-not $NoOpen) { Start-Process "https://localhost:$port/index.html" }

function Send-Bytes($ssl, $status, $type, $body) {
    $head = "HTTP/1.1 $status`r`nContent-Type: $type`r`nContent-Length: $($body.Length)`r`nConnection: close`r`n`r`n"
    $hb = [Text.Encoding]::ASCII.GetBytes($head)
    $ssl.Write($hb, 0, $hb.Length)
    $ssl.Write($body, 0, $body.Length)
    $ssl.Flush()
}

while ($true) {
    $client = $listener.AcceptTcpClient()
    try {
        $ssl = New-Object System.Net.Security.SslStream($client.GetStream(), $false)
        $ssl.AuthenticateAsServer($cert, $false, [System.Security.Authentication.SslProtocols]::Tls12, $false)
        # 读取请求行（GET /path HTTP/1.1），随后丢弃其余请求头
        $reader = New-Object IO.StreamReader($ssl, [Text.Encoding]::ASCII)
        $first = $reader.ReadLine()
        while (($null -ne ($line = $reader.ReadLine())) -and ($line -ne "")) { }
        if ($first) {
            $rawPath = ($first -split " ")[1]
            if ($rawPath) {
                $rel = [Uri]::UnescapeDataString(($rawPath -split "\?")[0]).TrimStart("/")
                if ($rel -eq "") { $rel = "index.html" }
                $path = Join-Path $root ($rel -replace "/", "\")
                $resolved = Resolve-Path -LiteralPath $path -ErrorAction SilentlyContinue
                if ($resolved -and $resolved.Path.StartsWith($root) -and (Test-Path -LiteralPath $resolved.Path -PathType Leaf)) {
                    $body = [IO.File]::ReadAllBytes($resolved.Path)
                    $ext = [IO.Path]::GetExtension($resolved.Path).ToLower()
                    $type = if ($mime[$ext]) { $mime[$ext] } else { "application/octet-stream" }
                    Send-Bytes $ssl "200 OK" $type $body
                } else {
                    $msg = [Text.Encoding]::UTF8.GetBytes("404 Not Found")
                    Send-Bytes $ssl "404 Not Found" "text/plain; charset=utf-8" $msg
                }
            }
        }
        $reader.Dispose()
        $ssl.Dispose()
    } catch {
        Write-Host ("请求处理异常: " + $_.Exception.Message) -ForegroundColor DarkGray
    } finally {
        try { $client.Dispose() } catch {}
    }
}
