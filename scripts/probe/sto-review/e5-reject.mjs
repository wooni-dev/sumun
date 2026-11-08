// E19 index.ts처럼 uncaughtException만 있을 때 저장소 안 처리 안 된 reject가 프로세스를 끝내는가
process.on('uncaughtException', (e) => { process.stderr.write(`fatal(${e?.code ?? e?.name})\n`); process.exit(1); });
setTimeout(() => console.log('살아 있음'), 100);
Promise.reject(Object.assign(new Error('flow SUMUN-SECRET-4'), { code: 'X' }));
