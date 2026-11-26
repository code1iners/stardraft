# 34: Sentry 토큰 연결

**Spec:** [스펙](../spec.md) 4절 "토큰", "연결 확인", "문제의 범위", 14절 "Sentry 칸", "온보딩"

**What to build:** 설정에 `Sentry` 칸이 생기고, 개인 토큰을 붙여 넣어 연결한다. 연결되면 토큰 카드에 조직이 보인다. 토큰 문제는 Sentry만 멈춘다.

**Blocked by:** 31

**Status:** resolved

- [x] Sentry API 포트와 sentry.io 어댑터가 있고, 조직 목록을 쪽 넘김까지 읽으며 조직별 지역 주소를 설정에 저장한다. 서버 주소 설정은 없다.
- [x] 토큰은 Flow 키와 같은 방식으로 암호화해 별도 파일에 저장된다. 로그와 화면에 토큰 값이 나오지 않는다.
- [x] 토큰을 넣으면 조직 목록으로 확인하고, 실패하면 빠진 scope(`org:read`)를 짚어 알린다.
- [x] 설정 칸 순서가 `Flow 계정 · Sentry · 에이전트 · 저장소 · 초안 · 일반`이다. 토큰이 없으면 토큰 입력만 보이고, 있으면 토큰 카드(조직 수와 이름, 권한, "연결됨" 또는 "토큰 확인 필요")가 보인다.
- [x] 토큰이 거부되거나 저장된 토큰을 풀 수 없으면 전역 문제 "토큰 확인 필요"가 뜨고 이유(거부, scope 부족, 읽기 불가)가 구분되어 보인다. Flow 감지와 Flow 초안은 멈추지 않는다. 새 토큰이 확인되면 해제된다.
- [x] 연결을 끊으면 토큰만 지워진다.
- [x] 온보딩 체크리스트의 선택 묶음에 Sentry 줄이 있다.
- [x] 가짜 Sentry API로 응답 코드별(`401`, `403`, 응답 없음) 동작이 테스트된다.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test`가 통과한다.


## Comments

- 구현 메모: Sentry API 포트(`core/ports/sentry-api.ts`)와 sentry.io 어댑터(`core/sentry/http-sentry-api.ts`)는 조직 목록만 안다. `Link` 헤더의 `rel="next"`에 `results="true"`일 때만 `cursor`로 쪽을 넘기고(상한 50쪽), 조직마다 `links.regionUrl`을 `settings.json`의 `sentryOrganizations`에 저장한다. 서버 주소 설정은 없다. 토큰을 실어 보낼 곳이 되므로 지역 주소는 `sentry.io` 계열의 https 주소만 받는다.
- 토큰은 Flow 키와 같은 암호화(`EncryptedSecretFile`)로 `sentry-token.bin`에 따로 둔다. 로그에는 토큰이 남지 않는다(테스트로 확인).
- 전역 문제 원인 `sentry-token`(이유 `rejected`·`scope-missing`·`unreadable`)을 더했다. Flow 키 문제와 서로 독립이라 Flow 감지·Flow 초안은 멈추지 않는다. 두 문제가 겹치면 띠에는 Flow 키가 먼저 보이지만 Sentry 칸의 토큰 카드는 자기 이유를 따로 보인다(`SentryConnection.state().problem`).
- 연결을 끊으면 토큰 파일과 토큰으로 읽은 조직 목록만 지운다. 다른 설정과 기록은 건드리지 않는다. 조직이 설정에 남은 채 토큰 파일만 없으면(파일 삭제 등) "읽기 불가"로 본다.
- 토큰 카드의 "권한"은 실제로 확인한 `org:read`만 "확인됨"으로 적고, `event:read`는 프로젝트를 추가할 때 확인한다고 적었다(35번이 그 확인을 더한다). 403의 `WWW-Authenticate`가 알려 주는 scope 이름은 쓰지 않고, 조직 목록 확인이 막히면 늘 `org:read`를 짚는다.
- 확인 못 함: 독일 등 다른 지역 조직이 있는 계정으로의 실호출(25번 조사와 같은 사유). 가짜 서버 테스트에서 `de.sentry.io` 지역 주소를 저장하는 것까지 확인했다.
- 전체 검증: `pnpm lint`, `pnpm typecheck` 통과. desktop 테스트는 1464개 중 1463개 통과, 실패 1개는 결정 #6의 `node-process-runner` "zsh rc 5초" 테스트(이 PC의 zsh 설정 영향, 이 티켓이 안 건드린 파일)다. site `index-page` 실패도 결정 #6과 같은 환경성 실패다.
