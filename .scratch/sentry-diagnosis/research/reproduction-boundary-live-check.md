# 재현 경계와 CLI 실측

- 실측일: 2026-11-26
- 티켓: [26 재현 경계와 CLI 실측](../issues/26-reproduction-boundary-live-check.md)
- 스펙: [7절 "CLI별 구현"](../spec.md), 테스트 결정의 "실기 점검 목록 · 재현 경계, 병렬 작업"
- 앞선 조사: [재현에 필요한 에이전트 실행 권한](agent-reproduction-permissions.md)(문서 기준), [실행 중 전달](mid-run-steering.md)
- 대상(이 PC 설치본): Claude Code `2.1.332`, Codex CLI `0.172.0`, macOS(APFS), Node `24.18.0`

## 읽는 법

| 표시 | 뜻 |
| :- | :- |
| **[실측]** | 이 PC에서 실제로 실행해 본 결과 |
| **[실측·모델 없음]** | Codex에서 모델 호출 없이 돌 수 있는 부분(`codex sandbox`, `codex mcp list`, MCP 시작)만 실행한 결과 |
| **확인 못 함(미구독)** | Codex 모델 호출이 필요해 하지 못했다. 이 계정은 Codex를 구독하지 않았고, 시험 실행은 `You’ve hit your usage limit ... try again at Nov 29th, 2026 2:05 PM.`으로 끝났다 |

시험 방법
- 비밀 파일 시험은 **가짜 사본**에서 했다. 임시 폴더에 가짜 원본 git 저장소(안에 linked worktree 하나)를 만들고, `.git`을 뺀 APFS 복제로 사본을 만든 뒤 가짜 `.env`·`.env.local`·`key.pem`·`.npmrc`·`secrets/a.txt`를 넣었다. 사본 밖에는 다른 저장소의 가짜 `.env`와 쓰기 시험용 폴더를 두었다.
- 점검 스크립트(`probe.sh`)는 값은 출력하지 않고 항목마다 `OK`/`FAIL(<종료 코드>) <오류 앞부분>`만 적는다. 셸의 `cat`, Node·Python 스크립트 읽기, `grep -r`, 사본 안팎 쓰기, 중첩 `.git`, git·npm, HTTPS(curl·Node·Python), localhost 서버, 환경 변수 노출을 본다.
- Claude Code는 이 스크립트를 Bash 도구로 한 번 돌리게 하고, 내장 Read·Write 도구로 사본 안팎을 시험하게 했다(모델 `haiku`, 실행 중 전달과 병렬은 `sonnet`도).
- 실제 재현 저장소(24번 티켓)는 복제 시간 측정에만 썼다. 원본은 읽기만 했고, 시험 뒤 `git status`가 깨끗하다. `.env` 값은 열지 않았다.
- 운영 서버를 부르는 요청은 없다. 네트워크 시험은 공개 사이트(`example.com`, `registry.npmjs.org`)만 불렀다.

---

## 결정용 요약

| 항목 | 결과 | 스펙 7절 표와 |
| :- | :- | :- |
| APFS 복제 시간 | `.git` 뺀 6.1GB·약 26만 파일: 맨 위 항목마다 `clonefile(2)` **약 5초**, `cp -c -R` **55~99초**. 삭제 약 24초 | 맞음. 방법은 `clonefile`로 정한다 |
| Claude 플래그 묶음 | 아래 "Claude Code 확정 묶음"으로 사본 쓰기·셸·네트워크·localhost가 열리고, 사본 밖 쓰기와 `.env` 말고 다른 비밀 패턴 읽기가 스크립트 경유까지 막힌다 | 맞음 |
| Claude 읽기 deny를 OS 차단으로 합칠 때 | 지금 형식(`Read(//**/<패턴>)`)을 그대로 합치면 `/etc/ssl/cert.pem`과 `~/.npmrc`가 막혀 curl·Python HTTPS가 깨진다. 작업 루트로 좁힌 형식은 부작용이 없다 | 맞음(좁힌 형식이 필요하다는 예상대로) |
| Claude 강제 종료 | MCP 서버는 CLI 그룹에 있어 그룹 종료로 끝난다. **Bash 명령(포그라운드·백그라운드)은 명령마다 따로 프로세스 그룹을 만들어 그룹 종료 뒤에도 살아남는다.** 자손 그룹을 먼저 끝내는 순서로는 모두 끝난다 | **다름.** 표는 Claude를 "프로세스 그룹 종료로 MCP까지 끝난다"로 두었다 |
| Codex 강제 종료 | MCP 서버는 Codex와 다른 프로세스 그룹이라 그룹 종료로는 살아남는다. 자손 그룹을 먼저 끝내면 모두 끝난다 [실측·모델 없음]. 백그라운드 명령은 확인 못 함(미구독) | 맞음 |
| Codex 플래그 묶음(샌드박스 부분) | 아래 "Codex 프로필 후보"로 같은 경계가 된다 [실측·모델 없음]. 글롭 경로는 `deny`만 되고, `**/.git`을 따로 막아야 한다 | 맞음 |
| Codex MCP 자동 승인·비활성 목록·실린 서버 읽기 | 비활성 목록의 없는 도구 이름은 서버 시작을 막지 않았다. 연결 실패는 `--json`에 나오지 않고 `RUST_LOG` 로그에만 나왔다. 자동 승인으로 조작 도구가 도는지는 확인 못 함(미구독) | 일부 확인 |
| Claude 실행 중 전달 | 앱 플래그 묶음 + MCP + 지침 파일 + `sonnet`으로도 메시지가 도구 호출 끝에 반영되고 구조화 출력이 나온다 | 맞음 |
| 시뮬레이터·에뮬레이터 | 켜진 목록 차집합으로 "새로 켜진 것"을 고르고 `simctl shutdown`·`adb emu kill`로 끈다. 사용자가 켠 시뮬레이터와 실기기는 남는다 | 맞음 |
| 병렬 작업 | Claude 5개 동시 실행 두 번(haiku 9초, sonnet 30초) 모두 성공, 인증·설정 파일 충돌 없음. Codex는 확인 못 함(미구독) | 상한 5 유지 |

**스펙과 다른 것 하나**: Claude Code도 강제 종료 때 자손 프로세스 그룹을 먼저 끝내야 한다. Codex와 같은 순서를 쓰면 된다(실측으로 통함). 그 밖의 발견은 스펙 방향은 그대로이고 구현에서 챙길 것이다(아래 "구현 메모").

---

## 1. APFS 복제 시간 [실측]

재현 저장소(24번 티켓): `.git` 제외 6.1GB, 파일 약 25만 9천 개, `node_modules` 1.1GB(pnpm 모노레포).

| 방법 | 시간 | 비고 |
| :- | :- | :- |
| `cp -c -R <항목> <사본>/`(맨 위 항목마다, `.git` 제외) | 99.4초, 55.0초, 54.3초 | 파일마다 복제하므로 파일 수에 비례한다 |
| `clonefile(src, dst, CLONE_NOFOLLOW)`(맨 위 항목마다, `.git` 제외) | 4.7초, 5.5초, 5.0초 | 디렉터리를 한 번에 복제한다 |
| 사본 삭제 `rm -rf` | 23.2초, 25초, 24초 | 스펙대로 뒤에서 지우고 기다리지 않는다 |

- 사본의 파일 수는 원본과 같았다(25만 9216개).
- **사본에 남는 것**: 이 저장소에는 Claude Code가 만든 linked worktree가 `.claude/worktrees/` 아래 둘 있다. 맨 위 `.git`만 빼면 이 worktree들의 `.git` 포인터 파일(`gitdir: <원본>/.git/worktrees/<이름>`)과, 원본 `.env`를 가리키는 절대 경로 심볼릭 링크 하나가 사본에 그대로 들어간다. 그래서 "사본에 `.git`이 없다"는 맨 위에만 맞다.
  - 아래 확정 묶음에서는 이것이 경계를 깨지 않았다. Claude는 `.git/**` 읽기 deny가 포인터 파일 읽기를 막아 git 명령이 `fatal: error reading .../.git`로 끝났다. 원본 `.git`에 쓰기는 두 CLI 모두 사본 밖이라 막혔다. 심볼릭 링크는 원본 경로로 풀려 `.env` 읽기 deny에 걸린다.
  - Codex는 `"**/.git/**"="deny"`만으로는 포인터 **파일**이 막히지 않는다. `"**/.git"="deny"`를 함께 넣어야 한다(§2.2).

## 2. 플래그 묶음

### 2.1 Claude Code

시험한 후보와 결과다. 모든 후보에 공통으로 `-p --output-format stream-json --verbose --json-schema <스키마> --tools Read,Glob,Grep,Bash,Edit,Write --permission-mode dontAsk --permission-prompts none --restricted --strict-mcp-config --no-session-persistence --max-turns 20`을 썼다.

| 점검 | 샌드박스 없음(기준) | A: 지금 deny 형식 그대로 + 샌드박스 | B: 작업 루트로 좁힌 형식 + 샌드박스 |
| :- | :- | :- | :- |
| 사본 `.env`·`.env.local`(Node·`cat`) | OK | OK | OK |
| 사본 `key.pem`·`.npmrc`·`secrets/`(Node 스크립트) | OK | 막힘(EPERM) | 막힘(EPERM) |
| 사본 밖 다른 저장소의 `.env` | OK | **OK(뚫림)** | 막힘 |
| `~/.ssh` 목록 | OK | **OK(뚫림)** | 막힘 |
| `~/.npmrc` | OK | 막힘 | 막힘 |
| `/etc/ssl/cert.pem` | OK | **막힘(부작용)** | OK |
| `~/.gitconfig`, `git --version`, `git config --global --list` | OK | OK | OK |
| `npm config get registry` | OK | OK | OK |
| 사본 쓰기(셸) | OK | OK | OK |
| `$TMPDIR` 쓰기(셸) | OK | OK | OK |
| 사본 밖·홈·원본 `.git` 쓰기(셸) | OK | 막힘 | 막힘 |
| 중첩 worktree에서 `git log`·`git commit` | OK | 막힘(포인터 파일 읽기 거부) | 막힘(같음) |
| curl HTTPS(`registry.npmjs.org`) | OK | 실패 77(인증서 파일 못 읽음) | OK |
| Python HTTPS | OK | 실패 | OK |
| Node `fetch` HTTPS | OK | 실패 `ENOTFOUND` | `NODE_USE_ENV_PROXY=1`일 때만 OK |
| localhost 서버 열고 접속 | OK | OK | OK(`allowLocalBinding`) |
| 셸에 넘어온 환경 변수(가짜 비밀) | 보임 | 보임 | 보임 |
| 내장 Read로 사본 `.env` / `key.pem` | – | OK / 거부 | OK / 거부 |
| 내장 Write로 사본 안 / 사본 밖 | – | 거부(`Write` 허용 규칙 없음) / 거부 | OK / 거부(`--restricted`) |

**Claude Code 확정 묶음**(B 중 실제로 모두 통한 조합)

- 플래그: 지금 묶음에서 `--tools`를 `Read,Glob,Grep,Bash,Edit,Write`로 바꾸고, `--disallowedTools mcp__*`를 빼고, 실을 서버가 있으면 `--mcp-config <임시 파일>`을 더한다. `--restricted`, `--strict-mcp-config`, `--permission-mode dontAsk`, `--permission-prompts none`, `--no-session-persistence`는 그대로다.
- `--settings` JSON의 모양:

```json
{
  "permissions": {
    "allow": ["Bash", "Edit", "Write", "mcp__<실은 서버>__*"],
    "deny": [
      "Read(//<사본 실제 경로>/**/<.env 계열을 뺀 비밀 패턴>)",
      "mcp__<서버>__<고정 deny 도구>"
    ]
  },
  "sandbox": {
    "enabled": true,
    "failIfUnavailable": true,
    "allowUnsandboxedCommands": false,
    "network": { "allowedDomains": ["*"], "allowLocalBinding": true },
    "filesystem": {
      "denyRead": ["/**/.env", "/**/.env.*", "~/.ssh", "~/.aws", "~/.npmrc", "~/.netrc", "~/.pypirc"],
      "allowRead": ["<사본 실제 경로>/**/.env", "<사본 실제 경로>/**/.env.*"]
    }
  }
}
```

- 사실
  - `autoAllowBashIfSandboxed`의 기본값이 `2.1.324`부터 `false`다(문서). 그래서 `dontAsk`에서는 `Bash` 허용 규칙이 있어야 셸이 돈다. 샌드박스와 `allowUnsandboxedCommands:false`가 있어 이 허용이 샌드박스 밖 실행으로 이어지지 않았다. 모델이 `dangerouslyDisableSandbox`를 쓴 일은 없었다.
  - 내장 Write는 `Edit` 허용만으로는 `dontAsk`에서 거부됐다. `Write` 허용을 더하자 사본 안 쓰기가 됐다. 사본 밖 쓰기는 `--restricted`가 계속 막았다.
  - 샌드박스 파일 규칙은 "더 좁은 경로가 이긴다"(문서). 루트 전체 `/**/.env` deny를 사본 아래 `allowRead`가 다시 열었다. 다른 비밀 패턴은 사본 경로로 좁힌 `Read(...)` deny로 걸었고 샌드박스 `denyRead`로 합쳐져 스크립트 경유 읽기까지 막혔다.
  - 경로는 실제 경로(`/private/var/...`처럼 심볼릭 링크를 푼 것)로 썼다.
  - 네트워크: `allowedDomains: ["*"]`로 모든 도메인이 열렸다(`WebFetch(domain:*)` 허용 규칙으로도 Python·curl은 됐다). 샌드박스 네트워크는 프록시(`HTTPS_PROXY`가 셸에 설정됨)를 거친다. **Node의 `fetch`는 프록시 변수를 보지 않아 `ENOTFOUND`로 실패했고 `NODE_USE_ENV_PROXY=1`을 넘기자 됐다.** 프록시를 쓰지 않는 도구(ssh, DB 드라이버 등)는 나가지 못한다(문서).
  - macOS 기본 curl로 `example.com`을 부르면 샌드박스 안에서만 `SSL certificate problem: unable to get local issuer certificate`(종료 60)가 났다. `registry.npmjs.org`는 됐다. `enableWeakerNetworkIsolation: true`를 줘도 같았다. 원인은 확인 못 함.
  - 셸 명령은 Claude Code가 만든 셸 스냅숏(`~/.claude/shell-snapshots/`, 사용자 zsh 함수·별칭과 `PATH`)을 먼저 읽고 돈다. 스냅숏이 내보낸 변수는 `PATH` 하나였다.

### 2.2 Codex [실측·모델 없음]

`codex sandbox --permission-profile <이름> -C <사본> -c permissions.<이름>.filesystem=... -c permissions.<이름>.network.enabled=true -- bash probe.sh`로 같은 점검 스크립트를 돌렸다. 모델을 부르지 않으므로 구독 없이 된다. `codex exec`의 실제 실행은 확인 못 함(미구독).

**Codex 프로필 후보**(모두 통한 것)

```toml
filesystem = { ":root" = "read",
  "~/**/.env" = "deny", "~/**/.env.*" = "deny",
  "~/.ssh" = "deny", "~/.aws" = "deny", "~/.npmrc" = "deny",
  ":workspace_roots" = { "." = "write",
    "**/*.pem" = "deny", "**/*.key" = "deny", "**/.npmrc" = "deny", "**/secrets/**" = "deny",
    "**/.git/**" = "deny", "**/.git" = "deny" } }
network.enabled = true
```

| 점검 | 결과 |
| :- | :- |
| 사본 `.env`·`.env.local` | OK |
| 사본 `key.pem`·`.npmrc`·`secrets/` | 막힘 |
| 홈 아래 다른 저장소의 `.env`(실제 재현 저장소 원본, 성공·실패만 봄) | 막힘 |
| `~/.ssh`, `~/.npmrc` | 막힘 |
| `/etc/ssl/cert.pem`, `~/.gitconfig` | OK |
| 사본 쓰기 | OK |
| 사본 밖·홈·원본 `.git`·`$TMPDIR` 쓰기 | 막힘 |
| 중첩 worktree `git log`·`git commit` | 막힘(`**/.git`이 있을 때) |
| curl·Node·Python HTTPS | OK(프록시 없이 직접 접속) |
| localhost 서버 열고 접속 | OK |
| 셸에 넘어온 환경 변수 | 보임(`codex sandbox` 기준. `exec`의 `shell_environment_policy` 적용은 확인 못 함(미구독)) |

- 사실
  - **글롭 경로는 `deny`만 된다.** `"**/.env"="read"`는 `filesystem glob path ... only supports deny access; use an exact path or trailing /** for read subtree access`로 거부됐다. 정확한 경로 `"<사본>/.env"="read"`는 받아들여지지만 루트 글롭 `"/**/.env"="deny"`를 다시 열지 못했다. 그래서 "사본 밖 `.env`는 막고 사본 `.env`는 연다"는 사본을 **홈 밖**(예: 임시 폴더)에 두고 `~/**/.env`를 막는 식으로만 됐다.
  - `"**/.git/**"="deny"`는 linked worktree의 `.git` **파일**을 막지 못했다. `"**/.git"="deny"`를 더하자 막혔다. 지금 읽기 전용 실행기는 루트 `".git"="deny"`만 쓴다.
  - 시험 중 `":tmpdir"="write"`를 줬을 때는 사본 밖 쓰기 시험 폴더(같은 `$TMPDIR` 아래)까지 쓰기가 열렸다. `$TMPDIR`을 쓰기로 열면 같은 임시 폴더에 있는 다른 사본도 열린다. 사본을 `$TMPDIR` 아래 두면 이 키를 쓰지 않는다.

## 3. 강제 종료와 프로세스 정리

앱처럼 새 세션(`start_new_session`)으로 CLI를 띄우고, 실행 중 `ps`로 자손 트리를 본 뒤 끝냈다.

### 3.1 Claude Code [실측]

시험: 시험용 stdio MCP 서버를 싣고, 백그라운드 Bash(`sleep 600`)와 포그라운드 Bash(Python `time.sleep(127)`)를 돌리는 중에 끝냈다.

| 프로세스 | 프로세스 그룹 | CLI 그룹 `SIGKILL`만 | 자손 그룹 먼저 → CLI 그룹 |
| :- | :- | :- | :- |
| `claude` | 자기 그룹 | 끝남 | 끝남 |
| stdio MCP 서버 | `claude`와 같음 | 끝남 | 끝남 |
| 백그라운드 Bash(`zsh -c ...` → `sleep 600`) | **명령마다 새 그룹** | **살아남음** | 끝남 |
| 포그라운드 Bash(`zsh -c ...` → `python3`) | **명령마다 새 그룹** | **살아남음** | 끝남 |

- 결론: 그룹 종료만으로는 dev 서버 같은 셸 명령이 남는다. Codex와 같은 순서(자손을 모아 그 그룹들을 먼저 끝내고 CLI 그룹을 끝냄)가 Claude Code에도 필요하다. **스펙 7절 표의 Claude 칸과 다르다.**
- 결과를 낸 뒤에도 백그라운드 명령이 돌고 있으면 `claude -p`는 끝나지 않고 열려 있었다(문서의 `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`, 기본 10분과 같은 동작).
- 스스로 부모를 떼는 프로세스(이중 fork로 `launchd` 아래로 옮겨 가는 것)는 자손 트리에서 빠지므로 이 방법으로도 못 끝낸다. 시험하지 않았다.
- `sleep`만 있는 포그라운드 명령은 Claude Code가 `Blocked: standalone sleep`으로 막았다(시험 명령을 Python으로 바꿨다).

### 3.2 Codex [실측·모델 없음]

`codex exec`에 인라인 MCP 서버를 넘기면, 모델 호출이 한도로 실패하기 **전에** MCP 서버를 띄우고 `initialize`·`tools/list`까지 마친다. 시험용 서버가 초기화 응답을 30초 늦추게 해 두고 그 사이에 끝냈다.

| 프로세스 | 프로세스 그룹 | CLI 그룹 `SIGKILL`만 | 자손 그룹 먼저 → CLI 그룹 |
| :- | :- | :- | :- |
| `codex exec` | 자기 그룹 | 끝남 | 끝남 |
| stdio MCP 서버 | **다른 그룹** | **살아남음** | 끝남 |
| 셸 환경을 읽는 `zsh -lc` 무리(로그인 셸로 `.zshrc`를 읽음) | 다른 그룹 | (이 시험에서는 자손 수집 때만 보임) | 끝남 |

- 스펙의 순서("CLI 그룹을 죽이기 직전에 자손을 모아 그 그룹들을 먼저 끝낸다")가 통한다. 순서를 뒤집으면 MCP 서버의 부모가 사라져 자손 트리에서 찾을 수 없다.
- 백그라운드 명령, 브라우저·시뮬레이터를 띄운 상태: 확인 못 함(미구독).

## 4. MCP 싣기

### Claude Code [실측]

- `--mcp-config <파일>` + `--strict-mcp-config`로 넘긴 서버가 `system/init`의 `mcp_servers`에 `{"name":"probe","status":"connected","source":"dynamic"}`로 나왔다. 실패하면 `"status":"failed"`다(정의 파일 경로를 틀렸을 때 실제로 봤다). `mcp_server_errors` 필드는 오지 않았다.
- `mcp__probe__*` 허용으로 도구가 묻지 않고 실행됐다.
- `mcp__probe__browser_run_code_unsafe` deny를 걸자 그 도구는 모델의 도구 목록에서 빠졌고 부르려 하면 `No such tool available`이었다. 서버에는 호출이 가지 않았다.
- 최소 환경 변수(`PATH`, `HOME`, `LANG`, `TMPDIR`, `USER`, `LOGNAME`, `SHELL`)만 넘겨 띄워도 구독 로그인으로 실행됐다.

### Codex [실측·모델 없음]

- 인라인 정의 `-c mcp_servers.<이름>.command=... -c mcp_servers.<이름>.args=[...] -c mcp_servers.<이름>.env={...}`가 `--ignore-user-config`와 함께 통했다(서버가 떠서 `tools/list`까지 받음).
- `disabled_tools`에 그 서버에 없는 이름(`no_such_tool_xyz`)을 넣어도 서버 시작과 `tools/list`는 정상이었다. 그 상태에서 모델에 보이는 도구 목록은 확인 못 함(미구독).
- **실린 서버와 연결 실패한 서버 읽기**: 없는 실행 파일을 가리키는 서버를 같이 넘겼지만 `--json` 출력에는 MCP 시작 이벤트가 성공·실패 모두 없었다. `RUST_LOG=info`를 주면 표준 오류에 `MCP server startup failed server_name="broken" error=No such file or directory (os error 2)`가 나왔다. 로그 DB(`~/.codex/logs_2.sqlite`)에는 이 실행의 기록이 없었다. 모델 턴이 도는 중에 다른 이벤트가 오는지는 확인 못 함(미구독).
- MCP 도구 승인을 자동 허용으로 줬을 때 조작 도구가 실행되는지, 주지 않으면 거부되는지: 확인 못 함(미구독). 시험에 쓴 `default_tools_approval_mode` 키는 오류 없이 받아들여졌지만, 알려지지 않은 키도 조용히 무시되는지 가리지 못했다.
- `codex mcp list --json`(약 4초)은 서버를 띄우지 않는 목록 명령이다. 항목 키는 `name`, `enabled`, `disabled_reason`, `transport`, `startup_timeout_sec`, `tool_timeout_sec`, `auth_status`다. `transport.type`은 `stdio`(`command`, `args`, `cwd`, `env`, `env_vars`)와 `streamable_http`(`url`, `http_headers`, `env_http_headers`, `bearer_token_env_var`, `http_headers_helper`)다.
  - **이 출력에는 `http_headers`·`env` 같은 값이 평문으로 들어 있다.** 앱은 이 출력을 로그에 남기지 말고 이름·종류·출처만 꺼내야 한다.
  - 사용자 설정 밖(플러그인 캐시 폴더를 `cwd`로 가진 것)의 서버도 목록에 섞여 나온다. 출처를 가리려면 `cwd` 같은 단서를 봐야 한다.

## 5. Claude Code 실행 중 전달 [실측]

- 묶음: 위 확정 묶음 + `--input-format stream-json` + `--mcp-config`(시험 서버 연결됨) + `--append-system-prompt-file` + `--max-turns 40` + `--model sonnet`(`claude-sonnet-5-5`), 최소 환경 변수.
- 6초짜리 명령을 8번 차례로 돌리게 하고 20.1초에 "지금 멈추고 구조화 출력을 내라"를 넣었다.
- 셋째 명령이 끝난 24.3초 직후 반영됐고 25.4초에 `--json-schema`에 맞는 구조화 출력(`rounds_done: 3`, `stopped_early: true`)이 나왔다. 종료 코드 0.
- 앞선 조사와 같이 메시지는 도구 호출이 끝나는 자리에서만 반영된다.

## 6. 시뮬레이터·에뮬레이터 [실측]

### iOS 시뮬레이터

- 판별: `xcrun simctl list devices booted -j`의 UDID 집합을 실행 전후로 비교한다. 사용자가 켜 둔 시뮬레이터(A)가 있는 상태에서 실행이 B를 켜면 차집합은 B 하나였다.
- 종료: `xcrun simctl shutdown <UDID>`. 12초 걸렸고 A는 그대로 남았다. 이미 꺼진 기기에 다시 보내면 `code=405 Unable to shutdown device in current state: Shutdown`이 온다(무시해도 된다).
- 부팅은 2~6초. 앱 종료의 "합쳐서 최대 5초"보다 종료가 오래 걸릴 수 있어, 스펙대로 5초 안에 안 꺼진 것은 두게 된다.

### Android 에뮬레이터

- 판별: `adb devices`의 시리얼 집합을 실행 전후로 비교한다. 실기기(USB) 하나가 연결된 상태에서 에뮬레이터를 켜자 차집합은 `emulator-5554` 하나였다. 처음에는 `offline`으로 보였다가 `device`가 됐다. 어떤 AVD인지는 `adb -s emulator-5554 emu avd name`으로 알 수 있었다.
- 종료: `adb -s <시리얼> emu kill`(`OK: killing emulator, bye bye`). 3초 안에 에뮬레이터 프로세스가 끝났다. 실기기와 adb 서버(사용자 것, 실행 전부터 떠 있던 것)는 그대로 남았다.
- 에뮬레이터 시리얼은 `emulator-`로 시작한다. 실기기를 끄는 명령은 보내지 않아야 하므로 차집합에서도 `emulator-` 시리얼만 끈다.

## 7. 병렬 작업 [실측(Claude)]

- 같은 로그인으로 Claude Code를 확정 묶음으로 5개 동시에 돌렸다. 각자 다른 사본에서 돌았다.
  - haiku, 짧은 실행: 5개 모두 성공, 구조화 출력 있음, 9초.
  - sonnet, 약 30초 실행(점검 스크립트 + 20초 대기): 5개 모두 성공, 27~30초.
  - 인증 오류·API 오류 없음. 세션 ID는 모두 달랐다. `~/.claude.json`은 전후 모두 올바른 JSON이었다. `--no-session-persistence`라 세션 파일은 만들지 않는다.
- 사용량 한도 오류의 모양: Claude는 한도에 닿지 않았고 일부러 닿게 하지 않았다(확인 못 함). 정상 실행의 스트림에 `{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","resetsAt":...,"rateLimitType":"five_hour","unifiedWindows":{...,"utilization":0.31}}}`가 온다.
- Codex 병렬: 확인 못 함(미구독). 참고로 이 계정의 Codex 한도 오류는 `--json`에서 `{"type":"error","message":"You’ve hit your usage limit. ... try again at Nov 29th, 2026 2:05 PM."}` 다음 `{"type":"turn.failed","error":{"message":"..."}}`, 종료 코드 1로 왔다.
- 병렬 작업 수 상한 5를 낮출 근거는 찾지 못했다.

## 8. 확인 못 한 것

| 항목 | 까닭 |
| :- | :- |
| Codex `exec` 전체 플래그 묶음으로 셸·쓰기·네트워크가 실제 에이전트 실행에서 되는지 | 미구독(한도). 샌드박스 정책은 `codex sandbox`로 확인함 |
| Codex 백그라운드 명령이 강제 종료로 끝나는지 | 미구독 |
| Codex MCP 도구 자동 승인으로 조작 도구가 실행되는지, 안 주면 거부되는지 | 미구독 |
| Codex 실행 중 MCP 연결 실패를 `--json`으로 알 수 있는지 | 미구독(모델 턴 전 단계만 봄) |
| Codex 2~5개 병렬의 세션·인증 충돌 | 미구독 |
| Claude 사용량 한도 오류의 모양 | 일부러 한도를 넘기지 않음 |
| 두 CLI가 인라인 원격 HTTP 서버에 저장된 OAuth 로그인을 다시 쓰는지 | 이 티켓의 체크 항목이 아니어서 하지 않음 |
| 브라우저·시뮬레이터를 띄운 상태에서의 자손 정리 | 시험용 MCP 서버와 셸 명령으로만 확인함 |
| 샌드박스 안 curl의 `example.com` 인증서 오류 원인 | 다른 HTTPS 도구와 다른 호스트는 됨 |

## 구현 메모

스펙 방향은 바꾸지 않고 구현 티켓(41~43번)에서 챙길 것이다.

- 사본은 `clonefile(2)`로 맨 위 항목마다 만든다(`.git` 제외). `cp -c -R`이나 파일 단위 복제(Node `fs.cp`의 복제 모드 등)는 파일마다 복제해서 이 저장소에서 1분 안팎이 걸린다. Node 표준 라이브러리에는 디렉터리를 한 번에 복제하는 호출이 없어 네이티브 호출 같은 다른 길이 필요하다.
- 사본 안 중첩 `.git` 포인터를 전제로 비밀 패턴을 건다: Claude는 지금 `.git/**`가 막고, Codex는 `"**/.git"="deny"`를 더한다.
- Claude `--settings`에 `Bash`·`Edit`·`Write` 허용 규칙을 넣는다(`autoAllowBashIfSandboxed` 기본값이 `false`).
- 비밀 패턴은 사본 경로로 좁힌 `Read(//<사본>/**/<패턴>)`로 넣고, `.env` 계열은 샌드박스 `denyRead` 루트 전체 + 사본 `allowRead`로 푼다. 루트 전체 형식(`Read(//**/<패턴>)`)을 그대로 쓰면 TLS가 깨진다.
- Claude 실행 환경의 최소 목록에 `NODE_USE_ENV_PROXY=1`을 더한다. 없으면 Node 서버 쪽 `fetch`가 샌드박스 프록시를 타지 못해 dev 서버의 API 호출이 실패한다.
- Codex 프로필은 사본을 홈 밖에 두고 `~/**/.env` 계열을 막는다. `$TMPDIR` 쓰기를 열면 같은 임시 폴더의 다른 사본도 열리니 사본을 `$TMPDIR`에 두면 열지 않는다.
- `codex mcp list --json` 출력에는 평문 값이 있다. 로그에 남기지 않는다.
- Codex 연결 실패 서버는 `RUST_LOG` 표준 오류의 `MCP server startup failed server_name="..."`로만 보였다. 이것에 기대려면 미구독 해제 뒤 다시 확인한다.
