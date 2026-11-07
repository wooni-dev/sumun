// [PRX-2] 테스트 도우미: 별도 프로세스로 띄우는 기록 프록시. 부모가 이 프로세스의 stdout/stderr를 모아
// 기록 내용(표식)이 콘솔로 새는지 본다 (F2, F4, I1, I2). 이 파일 자신은 아무것도 출력하지 않고, 부모와는 IPC로만 말한다.
//   node test/prx/_flow-child.ts <mode>    mode = ok | throw | reject
import { startProxy } from '../../src/proxy/server.ts';

const mode = process.argv[2] ?? 'ok';

const onFlow = (flow: any) => {
  // 기록이 왔다는 사실만 알린다. 내용은 보내지 않는다(부모는 프록시 동작만 본다)
  process.send?.({ type: 'flow', hasRequest: !!flow?.request });
  // 구독자가 기록 전체를 오류 메시지에 담아 던진다 — 프록시가 이 오류를 그대로 출력하면 유출이다
  if (mode === 'throw') throw new Error(JSON.stringify(flow));
  if (mode === 'reject') return Promise.reject(new Error(JSON.stringify(flow)));
};

const proxy = await startProxy({ port: 0, upstreamTimeoutMs: 300, onFlow } as Parameters<typeof startProxy>[0]);
process.send?.({ type: 'ready', port: proxy.port });
