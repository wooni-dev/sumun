// [UI-2] 실측: 이 PC에서 루프백으로 풀릴 수 있는 이름을 Node 기본 이름 해석(dns.lookup)이 어떻게 푸는가.
// 테스트에서 "루프백으로 풀리는 이름"을 인터넷 없이 흉내 낼 수 있는지, 이름을 글자로만 보고 막아도 되는지 정하려고 본다.
// 실행: node scripts/probe/ui2-names.mjs
import dns from 'node:dns';

for (const name of ['localhost', 'LOCALHOST', 'localhost.', 'a.localhost', 'a.localhost.']) {
  try {
    const r = await dns.promises.lookup(name, { all: true });
    console.log(`${name} -> ${r.map((a) => a.address).join(', ')}`);
  } catch (e) {
    console.log(`${name} -> 오류 ${e.code}`);
  }
}
