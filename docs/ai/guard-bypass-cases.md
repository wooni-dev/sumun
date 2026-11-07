# guard.mjs 우회 사례 (O10: 감사자가 제안)

출처: 2026-11-07, 별도 컨텍스트의 검토 에이전트가 guard.mjs(INFRA-3 병합 후, be71abe)를 **읽고 추론**한 결과 [추측: 실행하지 않음]. 작업자의 해결안은 알려 주지 않았다.
규칙 A = 커밋된 test/ 파일 수정 금지, 규칙 B = .claude/state/ 쓰기 금지.

## (가) 데이터 제거(stripData, INFRA-3)를 이용한 우회 — INFRA-3이 새로 만든 구멍
| # | 도구 | 명령 | 규칙 | 이유 |
|---|---|---|---|---|
| 1 | Bash | `echo '<<EOF'\nrm test/a.test.ts\nEOF` | A | 따옴표 안의 `<<`를 heredoc으로 오인 |
| 2 | Bash | `# <<EOF\nrm test/a.test.ts\nEOF` | A | 주석 안의 `<<` |
| 3 | Bash | `git commit -m "<<EOF"\nrm test/a.test.ts\nEOF` | A | 1과 같음 |
| 4 | Bash | `cat <<<EOF\nrm test/a.test.ts\nEOF` | A | `<<<`(here-string)를 heredoc으로 오인 |
| 5 | Bash | `echo $((1<<X))\nrm test/a.test.ts\nX` | A | 시프트 연산자 |
| 6 | Bash | `bash <<'EOF'\nrm test/a.test.ts\nEOF` (sh -s, node, python도 같음) | A | 실행되는 본문 [확인됨: AUDIT-2] |
| 7 | Bash | `xargs rm -f <<EOF\ntest/a.test.ts\nEOF` | A | 경로가 본문에 있음 |
| 8 | Bash | `xargs touch <<EOF\n.claude/state/x.json\nEOF` | B | 7과 같음 |
| 9 | Bash | `while read f; do rm "$f"; done <<EOF\ntest/a.test.ts\nEOF` | A | 7과 같음 |
| 10 | Bash | `cat <<EOF\n$(rm test/a.test.ts)\nEOF` | A | 따옴표 없는 heredoc 본문의 `$()`가 실행됨 |
| 11 | Bash | `git commit --allow-empty -m "$(rm test/a.test.ts)"` | A | `-m` 안의 `$()`가 실행됨 |
| 12 | Bash | ``git commit -m "`echo x > test/a.test.ts`"`` | A | 백틱 |
| 13 | PowerShell | `git commit --allow-empty -m "$(Remove-Item test/a.test.ts)"` | A | PowerShell `$()` |
| 14 | PowerShell | `git commit -m "a\" ; Remove-Item test/a.test.ts ; echo \"b"` | A | PowerShell은 `\"`가 이스케이프가 아님 |
| 15 | Bash/PS | `git checkout -m 'test/a.test.ts'` | A | `-m` 제거가 git commit에만 한정되지 않음 |
| 16 | PowerShell | `@'\ntest/a.test.ts\n'@ \| Remove-Item` | A | here-string 안의 경로가 지워짐 |
| 17 | PowerShell | `@'\n.claude/state/x.json\n'@ \| % { Set-Content $_ '{}' }` | B | 16과 같음 |
| 18 | PowerShell | `iex @'\nRemove-Item test/a.test.ts\n'@` | A | 실행되는 본문 [확인됨: AUDIT-2] |
| 19 | PowerShell | `$x = @"\n$(Remove-Item test/a.test.ts)\n"@` | A | `@"` 안의 `$()`가 실행됨 |
| 20 | PowerShell | `Write-Output 'a@'\nRemove-Item test/a.test.ts\n'@'` | A | here-string 경계로 오인 |
| 21 | PowerShell | `# @'\nRemove-Item test/a.test.ts\n'@'` | A | 주석 |
| 22 | Bash | `# @'\nrm test/a.test.ts\n'@'` | A | Bash에 here-string 규칙이 적용됨 |
| 23 | PowerShell | `Write-Output '<<EOF'\nRemove-Item test/a.test.ts\nEOF` | A | PowerShell에 heredoc 규칙이 적용됨 |

## (나) 출력 정리 제거(INFRA-1)를 이용한 우회
| 24 | Bash | `mkdir -p 1; echo x >&1/../test/a.test.ts` | A | `>&1`이 지워짐 |
| 25 | Bash | `mkdir -p 1; echo '{}' >&1/../.claude/state/x.json` | B | 24와 같음 |

## (다) 경로 패턴 우회 (INFRA-1부터 있던 한계)
| 26 | Bash/PS | `echo x >test/a.test.ts` (`>>`, `1>`, `&>`) | A | `>` 뒤 공백이 없으면 경로 패턴이 맞지 않음 |
| 27 | Bash | `cat <<'EOF' >test/a.test.ts\nnew\nEOF` | A | 26과 같음 |
| 28 | Bash | `rm {test,x}/a.test.ts`, `rm te?t/...`, `rm t*/...`, `${D}t/...` | A | glob, 변수 |
| 29 | PowerShell | `Remove-Item x,test/a.test.ts` | A | `,` 앞 |
| 30 | Bash | `cd test && rm a.test.ts`, `find test -name a.test.ts -delete` | A | `test/` 문자열이 없음 |
| 31 | Bash | `echo '{}' > .claude/"state"/x.json`, `.claude/./state` | B | 경로 표기 변형 |

## (라) 목록에 없는 쓰기 수단 (INFRA-1부터 있던 한계)
| 32 | `sed -Ei`, `--in-place` | 33 | `dd`, `ln -sf`, `install`, `perl -pi`, `chmod` | 34 | `git clean`, merge, pull, cherry-pick, revert, rebase |
| 35 | node `renameSync`, `copyFileSync` | 36 | python `open(...,'w')` | 37 | `[System.IO.File]::WriteAllText` |
| 38 | PowerShell 별칭 `ri`, `sc`, `ni` | 39 | `patch`, `git apply` (heredoc 패치) | 40 | `eval "$(... \| base64 -d)"`, `-EncodedCommand` |

## 계속 허용해야 하는 정상 명령 (오탐 금지)
1. `git commit -m "$(cat <<'EOF' ... EOF\n)"` — Claude Code 표준 커밋 방식(11~13번과 구별해야 함)
2. `git commit -m "test: a > b 비교 수정 (test/a.test.ts)"`
3. PowerShell `git commit -m @'...'@`
4. `cat <<'EOF' > docs/ai/progress.md\ntest/a.test.ts ... a > b\nEOF` (연속 실패 상태에서도 허용)
5. `gh pr create --body "$(cat <<'EOF' ... EOF\n)"`
6. `node --test test/a.test.ts 2>&1`, `npm test > /dev/null 2>&1`, PowerShell `2>$null`
7. `git diff HEAD -- test/a.test.ts`, `git show HEAD:test/...`, `git log -- test/`
8. `git checkout -b feature/x`, `git stash list`
9. `echo '<a@b.com>'`, `git tag -a v1 -m 'release <x@y>'`
- 참고(현재도 오탐): `node --test ... 2>&1 | tee log.txt`, `rg "> " test/`
