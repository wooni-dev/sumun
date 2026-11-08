// [STO 최종 검토] 기록(Flow)·시작 알림(FlowStart)을 만드는 도우미. 실제 프록시 없이 저장소만 시험할 때 쓴다.
export function mkStart(id, { method = 'GET', host = 'example.com', port = 80, path = '/', url } = {}) {
  return {
    id,
    startedAt: Date.now(),
    request: { method, url: url ?? `http://${host}:${port}${path}`, httpVersion: '1.1', headers: [['Host', host]], target: { scheme: 'http', host, port, path } },
  };
}

export function mkFlow(id, o = {}) {
  const { method = 'GET', host = 'example.com', port = 80, path = '/', url, status = 200, reqBody = 0, resBody = 0, headers = 4, noResponse = false, error, scheme = 'http' } = o;
  const hp = [];
  for (let i = 0; i < headers; i++) hp.push([`X-H${i}`, `v${i}-${id}`]);
  const body = (n) => {
    const b = Buffer.allocUnsafeSlow(n);
    b.fill(0x61);
    return b;
  };
  const f = {
    id,
    startedAt: Date.now(),
    durationMs: 1,
    request: { method, url: url ?? `${scheme}://${host}:${port}${path}`, httpVersion: '1.1', headers: [['Host', host], ...hp], target: { scheme, host, port, path }, body: body(reqBody), bodySize: reqBody, bodyTruncated: false },
  };
  if (!noResponse) f.response = { httpVersion: '1.1', headers: hp.map(([n, v]) => [n, v]), body: body(resBody), bodySize: resBody, bodyTruncated: false, status, statusMessage: 'OK' };
  if (error) f.error = error;
  return f;
}
