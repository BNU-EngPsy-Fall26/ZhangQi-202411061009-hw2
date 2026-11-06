# 临时 HTTP 服务器（仅测试用）：localhost 也是安全上下文，避免证书干扰
$root = "c:\Users\wai\OneDrive\桌面\工程心理学作业2\attention-lab-hw2"
$mime = @{
    ".html" = "text/html; charset=utf-8"; ".js" = "text/javascript; charset=utf-8"
    ".css" = "text/css; charset=utf-8"; ".json" = "application/json; charset=utf-8"
    ".png" = "image/png"; ".svg" = "image/svg+xml"
}
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:8766/")
$listener.Start()
Write-Host "temp HTTP server on http://localhost:8766/"
while ($true) {
    $ctx = $listener.GetContext()
    try {
        $rel = [Uri]::UnescapeDataString(($ctx.Request.RawUrl -split "\?")[0]).TrimStart("/")
        if ($rel -eq "") { $rel = "index.html" }
        $path = Join-Path $root ($rel -replace "/", "\")
        if ((Test-Path -LiteralPath $path -PathType Leaf) -and ($path.StartsWith($root))) {
            $body = [IO.File]::ReadAllBytes($path)
            $ext = [IO.Path]::GetExtension($path).ToLower()
            $ctx.Response.ContentType = if ($mime[$ext]) { $mime[$ext] } else { "application/octet-stream" }
            $ctx.Response.ContentLength64 = $body.Length
            $ctx.Response.OutputStream.Write($body, 0, $body.Length)
        } else { $ctx.Response.StatusCode = 404 }
    } catch { try { $ctx.Response.StatusCode = 500 } catch {} }
    try { $ctx.Response.Close() } catch {}
}
