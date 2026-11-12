# Sentry 오류 이슈 진단 보고서

Label: wayfinder:map
Created: 2026-11-12

## Destination

이 지도가 끝나면 **구현 착수용 스펙**(`.scratch/sentry-diagnosis/spec.md`)이 나온다.

스펙이 다루는 기능은 다음과 같다.

- Sentry를 Flow에 이은 두 번째 **프로바이더**로 추가한다.
- 등록한 Sentry 프로젝트에서 새로 생기거나 재발한 **오류 이슈**를 감지한다.
- **에이전트**가 매핑된 저장소를 읽고 `diagnosing-bugs` 절차에 따라 시뮬레이터·에뮬레이터·브라우저로 **재현**을 시도한다.
- 에이전트가 원인과 개선 방향을 담은 **진단 보고서**를 만든다.
- 사용자는 진단 보고서를 앱에서 검토하고 파일로 저장한다.

스펙만 보고 티켓을 나눠 바로 구현에 들어갈 수 있으면 도착이다.

## Notes

- **도메인**: Sentry(sentry.io) 오류 모니터링, 기존 Flow 프로바이더, 로컬 저장소, 로컬 CLI 코딩 에이전트(Claude Code, Codex).
- **용어**: 저장소 루트의 [GLOSSARY.md](../../GLOSSARY.md)를 따른다. 이 지도에서 정한 용어는 **프로바이더**, **오류 이슈**, **재현**, **진단 보고서**이고, **초안**의 뜻도 넓혔다. Sentry의 "이벤트"(개별 발생)와 **오류 이슈**(묶음)를 섞어 쓰지 않는다.
- **티켓 유형별로 쓰는 스킬**
  - grilling 티켓: `grilling`, `domain-modeling`
  - prototype 티켓: `prototype`
  - research 티켓: `research`
  - 화면이 걸린 결정: `ui-design`을 함께 쓴다.
  - 재현 절차가 걸린 결정: `diagnosing-bugs`를 참고한다.
- **진행 방식**: 지도와 티켓은 차팅 세션에서 만들고, 각 티켓은 새 세션에서 하나씩 진행한다. research 티켓도 차팅 세션에서 실행하지 않았다.
- **문서 언어**: 이 지도의 모든 문서는 한국어로 쓴다.
- **조사 결과 위치**: 조사 결과는 이 폴더의 `research/`에 파일로 두고 티켓에서 링크한다.
- **현재 코드 사실**: 에이전트 실행은 읽기 전용이다. Claude Code는 `--tools Read,Glob,Grep`·`--restricted`·MCP 차단(`apps/desktop/src/core/agent/claude-code-executor.ts`), Codex는 셸 명령을 실행하되 권한 프로필(Seatbelt)로 읽기 범위를 제한하고 쓰기와 네트워크를 막는다(`apps/desktop/src/core/agent/codex-executor.ts`). 재현은 이 경계를 여는 일이라서 가장 무거운 결정이다.

### 차팅 중 확정된 전제

티켓 없이 정한 사항이다. 바꾸려면 지도를 다시 그려야 한다.

- **목적지 형태**: 구현은 지도 밖이고, 결과물은 스펙이다.
- **프로바이더**: Sentry는 Flow와 대등한 프로바이더다. 나중에 Slack·Gmail·Threads 등이 더 붙을 수 있다. 이번에는 Sentry를 붙이는 데 실제로 필요한 공통 경계만 정한다. 이후 프로바이더는 그 경계에 맞는지 점검만 하고 설계하지 않는다.
- **트리거 단위**: 새로 생긴 오류 이슈와 해결 후 재발한 오류 이슈마다 진단을 한 번 한다. 이벤트 단위로는 진단하지 않고, 수동 진단 요청도 두지 않는다.
- **진단 대상**: 등록한 Sentry 프로젝트의 오류 이슈 중 환경(예: `production`)과 레벨(예: `error` 이상) 필터를 통과한 것이다. Sentry 배정 여부는 보지 않는다.
- **저장소 찾기**: Flow처럼 Sentry 프로젝트와 로컬 저장소를 잇는 **저장소 매핑**을 쓴다.
- **결과물과 행선지**: 진단 보고서는 앱에서 검토하고 마크다운 파일로 저장한다. 외부에 게시하지 않는다.
- **재현 책임**: 앱은 재현 환경을 준비하지 않는다. 에이전트에게 `diagnosing-bugs` 절차와 재현 도구 사용을 허용한 **지침**을 넘기고, 에이전트가 자기 도구로 재현을 시도한다. 결과는 성공·실패·불가 중 하나로 보고서에 적는다.
- **Sentry 종류**: 공식 sentry.io만 지원한다. 서버 주소 설정은 두지 않는다(차팅 때 "서버 주소만 열어 둔다"로 잘못 적었던 것을 [계정 연결 티켓](issues/04-sentry-connection-and-mapping.md)에서 바로잡음).
- **프로바이더는 모두 선택**: Flow를 포함해 어떤 프로바이더도 필수가 아니다(같은 티켓에서 정함).

## Decisions so far

<!-- 닫힌 티켓마다 한 줄: 관련성을 판단할 만큼의 요지 + 링크 -->

- [Flow 전용 구조에서 프로바이더 공통 경계 후보 조사](issues/03-provider-seam-codebase-research.md): 공통으로 쓸 수 있는 것은 실행기 포트뿐이고 나머지는 Flow 묶음 타입에 묶여 있다. 경계 후보는 A(묶음에 종류 추가)·B(대기열의 실행 관리를 공통으로 떼고 프로바이더 어댑터)·C(실행기 포트만 공유) 셋이다. 이와 별도로 대기열 직렬 실행·Flow 키 멈춤·계정 리셋이 Sentry 쪽에 미치는 영향도 적었다.
- [Sentry 오류 이슈 감지와 인증 조사](issues/01-sentry-detection-auth-research.md): 조직 단위 이슈 목록 API를 폴링해 감지할 수 있다(신규는 `firstSeen` 체크포인트, 재발은 `is:regressed`). 인증은 개인 토큰에 `org:read`+`event:read`이고 조직 토큰은 쓸 수 없다. 환경·레벨·프로젝트 필터는 서버에서 걸 수 있고, 진단 데이터는 `events/latest/` 한 번으로 받는다. 지역별 `regionUrl`과 rate limit은 주의해야 한다.
- [재현에 필요한 에이전트 실행 권한 조사](issues/02-agent-reproduction-permissions-research.md): 두 CLI 모두 macOS Seatbelt로 쓰기 범위와 네트워크를 좁힐 수 있다. Codex는 이미 OS 수준에서 셸 경유 비밀 읽기를 막고, Claude는 샌드박스를 켜야만 막힌다. MCP(Playwright)는 샌드박스 밖에서 돈다. 환경 변수가 그대로 넘어가는 문제와 `mcp__*` deny 구조도 바꿔야 한다. 정리한 선택지는 A~F다.
- [Sentry 계정 연결, 진단 대상 필터, 저장소 매핑 설정](issues/04-sentry-connection-and-mapping.md): 개인 토큰 하나를 safeStorage로 저장하고, 문제가 생기면 Sentry 감지만 멈춘다. 여러 조직을 허용하며 프로젝트는 옵트인으로 등록하고 `id`를 키로 쓴다. 환경·레벨 필터는 프로젝트마다 두고(기본 `production`, `error`·`fatal`), 등록 시각을 기준 시각으로 잡는다. 설정은 `settings.json`에 두므로 Flow 리셋에도 남는다. 화면은 `Sentry` 칸을 새로 두고 매핑은 `저장소` 칸에 모은다. sentry.io만 지원하고, 온보딩에서 Flow 필수를 풀어 모든 프로바이더를 선택으로 둔다.
- [재현 실행의 보안 경계](issues/05-reproduction-security-boundary.md): 샌드박스로 가두지 않고, 저장소마다 켠 **재현 허용** 아래에서 내 개발 환경을 APFS 복제 사본(`.git` 제외)으로 그대로 쓴다. 사본의 `.env`는 저장소별 **재현용 환경 파일**이고 그 값의 노출은 받아들인다. 셸·네트워크를 열고, 사용자의 MCP 정의만 가져와 에이전트가 직접 조작한다(기본 `자동` + 위험 도구 deny, `직접 선택` 가능). 상한 20분, 새로 켜진 시뮬레이터만 정리. [ADR 0003](../../docs/adr/0003-reproduction-opens-agent-boundary.md).
- [저장소 매핑이 없는 Sentry 프로젝트의 오류 이슈 처리](issues/06-unmapped-sentry-project.md): 추측하지 않는다. 자동 선택·경로 추정 없이 **저장소 매핑 필요**로 남기고, 그 프로젝트에 매핑을 저장하면 자동으로 재개한다. 오류 이슈 하나에만 고르는 경로는 두지 않는다. Sentry 매핑은 프로젝트 하나에 저장소 하나이고 같은 저장소를 여러 프로젝트에 매핑할 수 있다. 매핑된 폴더가 사라지면 **저장소 확인 필요**로 멈춘다.
- [재현용 MCP 불러오기와 위험 도구 목록 조사](issues/10-reproduction-mcp-research.md): Claude는 `--restricted`에서 사용자 MCP가 전혀 실리지 않으므로 앱이 설정 파일을 읽어 `--mcp-config`로 넘겨야 한다. Codex는 `--ignore-user-config`를 유지한 채 `-c mcp_servers.*`로 넘길 수 있다. `${VAR}` 인증과 최소 환경 변수가 충돌하고, Codex는 승인 `never`에서 조작 도구가 막힐 수 있으며, Codex의 MCP 프로세스는 그룹 SIGKILL을 견딘다. deny는 Claude glob, Codex 서버별 `disabled_tools`로 걸고, 우회되는 도구가 있다.

## Not yet specified

- **진단 실행 큐**: 기존 초안 큐와 함께 쓸지 따로 둘지, 동시 실행 수(재현 실행은 시뮬레이터·dev 서버 포트를 나눠 쓰므로 함께 돌릴 수 있는지), 취소 처리. 실행 한 번의 상한은 [보안 경계](issues/05-reproduction-security-boundary.md)에서 20분으로 정했다. 공통 경계 결정(B냐 C냐)이 나오면 티켓으로 만든다. 걸리는 사실(Flow 키 멈춤, 단일 `busy` 직렬화, 고정 시간 상한, `draft_queue` 키)은 [경계 조사](research/provider-seam-candidates.md)에 있다.
- **Sentry 실행 상태의 저장 위치**: 등록·필터·기준 시각·매핑은 `settings.json`으로 정했다. 감지 체크포인트·중복 억제 기록·진단 상태처럼 실행 중에 바뀌는 상태는 아직 정하지 않았다. 같은 `state.db`에 두면 Flow 계정을 바꿀 때 실행되는 `resetForAccount`가 Sentry 표까지 지운다. 보존 목록에 넣을지, 저장소를 따로 둘지 정해야 한다.
- **`diagnosing-bugs` 전달 방식**: 에이전트 쪽에 스킬이 설치되어 있다고 가정할지, 절차를 지침에 직접 넣을지.
- **따라잡기와 중복 억제**: PC가 꺼져 있는 동안 쌓인 오류 이슈를 처리하는 방법, 같은 오류 이슈가 거듭 재발할 때 진단을 반복하지 않는 기준. [API 조사](research/sentry-api-facts.md)에서 확인한 제약이 있다. 재발 상태는 7일 뒤 `ongoing`으로 바뀌어 그보다 오래 꺼져 있던 동안의 재발은 되찾을 수 없다. 재발마다 남는 `SET_REGRESSION` 활동(`event_id`·`version`)은 중복 억제 키 후보다. 보관 뒤 다시 늘어나는 `escalating` 오류 이슈는 지금 전제("해결 후 재발")에 들어가지 않는데, 이대로 둘지 확인해야 한다.
- **검토 화면과 알림**: 진단 보고서 검토 화면, 트레이 알림, **지시**를 받아 다시 진단하는 흐름. Flow 초안 검토 화면과 얼마나 공유할지. **저장소 매핑 필요**·**저장소 확인 필요** 상태의 오류 이슈를 어떻게 알릴지(오류 이슈마다 알릴지, 프로젝트 단위로 묶어 알릴지)도 여기서 정한다.
- **실패 처리**: 재현이 불가능하거나 이벤트 데이터(스택트레이스, breadcrumbs, release)가 부족할 때 보고서와 상태를 어떻게 남길지.

## Out of scope

- Sentry 이슈 댓글이나 Flow로 진단 보고서를 게시하는 것.
- Slack·Gmail·Threads 등 다른 프로바이더 추가.
- 이벤트 단위 진단, 수동 진단 요청.
- 진단 결과에 따른 자동 수정이나 PR 생성.
- 앱이 재현 환경(시뮬레이터 부팅, 브라우저 설치 등)을 직접 준비하는 것.
- 자가 호스팅 Sentry 지원(서버 주소 설정 포함).
