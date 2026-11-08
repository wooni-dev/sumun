# e6-reuse.ps1: 127.0.0.1(또는 ::1):Port에 소켓 옵션을 바꿔 bind/listen 해 본다. 접속이 오면 "STOLEN"으로 답한다.
# 사용: powershell -NoProfile -File e6-reuse.ps1 -Port 60000 -Mode reuse|exclusive|plain [-Addr 127.0.0.1] [-Seconds 6] [-NoListen]
param([int]$Port, [string]$Mode = 'reuse', [string]$Addr = '127.0.0.1', [int]$Seconds = 6, [switch]$NoListen)
$ip = [System.Net.IPAddress]::Parse($Addr)
$s = New-Object System.Net.Sockets.Socket($ip.AddressFamily, [System.Net.Sockets.SocketType]::Stream, [System.Net.Sockets.ProtocolType]::Tcp)
try {
  if ($Mode -eq 'reuse') { $s.SetSocketOption([System.Net.Sockets.SocketOptionLevel]::Socket, [System.Net.Sockets.SocketOptionName]::ReuseAddress, $true) }
  if ($Mode -eq 'exclusive') { $s.ExclusiveAddressUse = $true }
  $s.Bind((New-Object System.Net.IPEndPoint($ip, $Port)))
  if (-not $NoListen) { $s.Listen(16) }
  [Console]::Out.WriteLine("BOUND $Mode $Addr`:$Port listen=$(-not $NoListen)"); [Console]::Out.Flush()
} catch {
  [Console]::Out.WriteLine("FAIL $Mode $($_.Exception.InnerException.SocketErrorCode)$($_.Exception.SocketErrorCode)"); [Console]::Out.Flush()
  exit 1
}
$deadline = (Get-Date).AddSeconds($Seconds)
while ((Get-Date) -lt $deadline) {
  if (-not $NoListen -and $s.Poll(200000, [System.Net.Sockets.SelectMode]::SelectRead)) {
    $c = $s.Accept()
    $b = [Text.Encoding]::ASCII.GetBytes("HTTP/1.1 200 OK`r`nContent-Length: 6`r`nConnection: close`r`n`r`nSTOLEN")
    [void]$c.Send($b); $c.Shutdown('Both'); $c.Close()
  } else { Start-Sleep -Milliseconds 100 }
}
$s.Close()
