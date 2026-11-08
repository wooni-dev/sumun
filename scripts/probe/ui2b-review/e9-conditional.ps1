# e9-conditional.ps1: SO_CONDITIONAL_ACCEPT(0x3002)를 켠 리스너. DelayMs 동안 Accept를 부르지 않다가 그 뒤 접속에 "STOLEN"으로 답한다.
# 사용: powershell -NoProfile -File e9-conditional.ps1 -Port 60000 [-Addr ::1] [-DelayMs 3000] [-Seconds 10]
param([int]$Port, [string]$Addr = '::1', [int]$DelayMs = 3000, [int]$Seconds = 10)
$ip = [System.Net.IPAddress]::Parse($Addr)
$s = New-Object System.Net.Sockets.Socket($ip.AddressFamily, [System.Net.Sockets.SocketType]::Stream, [System.Net.Sockets.ProtocolType]::Tcp)
try {
  $s.SetSocketOption([System.Net.Sockets.SocketOptionLevel]::Socket, [System.Net.Sockets.SocketOptionName]0x3002, $true)
  $s.Bind((New-Object System.Net.IPEndPoint($ip, $Port)))
  $s.Listen(16)
  [Console]::Out.WriteLine("READY conditional $Addr`:$Port"); [Console]::Out.Flush()
} catch { [Console]::Out.WriteLine("FAIL $($_.Exception.Message)"); [Console]::Out.Flush(); exit 1 }
Start-Sleep -Milliseconds $DelayMs
$deadline = (Get-Date).AddSeconds($Seconds)
while ((Get-Date) -lt $deadline) {
  if ($s.Poll(200000, [System.Net.Sockets.SelectMode]::SelectRead)) {
    try {
      $c = $s.Accept()
      $b = [Text.Encoding]::ASCII.GetBytes("HTTP/1.1 200 OK`r`nContent-Length: 6`r`nConnection: close`r`n`r`nSTOLEN")
      [void]$c.Send($b); $c.Shutdown('Both'); $c.Close()
    } catch {}
  }
}
$s.Close()
