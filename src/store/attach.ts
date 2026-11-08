// [STO-4] 저장소를 프록시에 연결한다: startProxy({ ...attachStore(store) })
//
// - 시작 알림(onFlowStart)과 기록(onFlow)을 함께 돌려준다. 하나만 걸면 진행 중만 쌓이거나 시작이 빠진다(sto-cases B2).
// - 결정 S-7: 저장소 하나에 프록시 하나. 프록시마다 id가 1부터 시작하므로, 둘을 한 저장소에 넣으면 기록이 덮이거나 잘못 짝지어진다(B3·F2).
// - 프록시 close 뒤에 도착하는 기록(진행 중이던 요청의 aborted)도 실제로 있었던 요청이므로 보통 기록처럼 저장한다(B7·F1).
// 콜백 안의 오류는 프록시의 emitFlow가 받아 고정 문구만 남긴다(PRX-2). 저장소는 잘못된 모양에만 TypeError를 던진다.
import type { Flow, FlowStart } from '../flow/flow.ts';
import type { Store } from './store.ts';

const attached = new WeakSet<object>();

export function attachStore(store: Store): { onFlowStart: (start: FlowStart) => void; onFlow: (flow: Flow) => void } {
  if (!store || typeof store !== 'object' || typeof store.addStart !== 'function' || typeof store.addFlow !== 'function') {
    throw new TypeError('attachStore에는 createStore()로 만든 저장소를 넘겨야 합니다.');
  }
  if (attached.has(store)) throw new Error('이 저장소는 이미 다른 프록시에 연결되어 있습니다(저장소 하나에 프록시 하나).');
  attached.add(store);
  return {
    onFlowStart: (start) => store.addStart(start),
    onFlow: (flow) => store.addFlow(flow),
  };
}
