# 앱 내 업데이트 macOS 실기 검증

Map: [Flow 멘션 답변 초안 앱](../map.md)
Type: task
Mode: HITL
Status: resolved
Blocked by:

## Question

ad-hoc 서명한 Electron 앱이 electron-updater로 **실제로 업데이트되고 다시 실행되는지**, 그 뒤 macOS가 무엇을 다시 묻는지 이 Mac에서 확인한다.

[다운로드 사이트 형태 결정](09-download-site.md)에서 앱 내 업데이트를 범위에 넣었다. macOS에서 채택할지는 이 검증 결과로 정한다. 실험 절차, 볼 것, 중단 조건, 복구 방법은 [앱 내 업데이트 가능성 조사](../research/in-app-update.md) 6절을 그대로 따른다.

- **변형 B**: 최상위 번들만 `identifier` 명시 DR로 다시 서명한다. v0.0.1 → v0.0.2 업데이트가 성공하는지 본다.
- **변형 A**: 기본 ad-hoc 서명을 그대로 둔다. 업데이트가 거부되는지 본다.
- **사용자가 할 일**
  - "그래도 열기" 누르기
  - 알림 허용
  - Keychain "항상 허용"
  - 로그인 항목 켜기
- **기록할 것**: 아래 항목을 `## Answer`에 남긴다.
  - 재실행 여부와 재실행 뒤 버전
  - 새 번들의 quarantine 여부
  - Gatekeeper 대화상자가 떴는지
  - 앱 수정 보호 알림이 떴는지
  - Keychain을 다시 물었는지
  - 알림 권한과 로그인 항목이 유지됐는지
  - ShipIt 로그
- **판정**
  - 변형 B가 성공하면 macOS도 앱 내 업데이트를 채택한다.
  - 실패하거나 앱 수정 보호에 막히면 macOS는 수동 업데이트와 새 버전 알림으로 돌아간다. [앱 내 업데이트 방식 결정](22-in-app-update-design.md)에 그 결과를 넘긴다.

## Answer

2026-10-19에 사용자와 함께 확인했다. **변형 B(최상위 명시 DR)는 v0.0.1 → v0.0.2 업데이트와 재실행에 성공했다. 변형 A(기본 ad-hoc)는 예상대로 설치 전에 거부됐다.** 판정에 따라 macOS도 앱 내 업데이트를 채택한다.

- **환경**: macOS 27.0.1(26A434), Apple Silicon, 관리자 계정. Electron 44.7.2, electron-builder 26.17.0, electron-updater 6.8.10.
- **앱과 서버**: 코드는 [prototypes/in-app-update-check](../prototypes/in-app-update-check/main.js)에 있다. 구현 코드로 재사용하지 않는다.
  - `UpdateProbe`(`app.example.updateprobe`)는 시작할 때 버전, 실행 경로, 로그인 항목 상태를 남긴다. `safeStorage` 복호화에 걸린 시간과 시작 알림의 `show`/`failed`도 남긴다. 기록 위치는 `~/Library/Logs/UpdateProbe/probe.log`다.
  - 업데이트 설정은 조사 추천안을 따랐다. `autoInstallOnAppQuit = false`, `disableDifferentialDownload = true`로 두고, `update-downloaded`에서 `quitAndInstall()`을 부른다.
  - 변형 B는 [after-sign.js](../prototypes/in-app-update-check/after-sign.js)에서 최상위 번들만 다시 서명했다.
  - [server.js](../prototypes/in-app-update-check/server.js)가 `localhost:8001/feed/*`를 `127.0.0.1:8002/*`로 302 한다. 다중 Range에는 501을 준다.
  - 판정 근거는 네 가지다. 앱 기록, ShipIt 로그, 시스템 로그(`securityd`, `tccd`, `usernoted`, `authd`), 서버 기록.
- **6절과 다르게 한 것**
  - 변형 A v0.0.1은 Chrome과 Gatekeeper를 거치지 않고, 빌드 산출물을 `/Applications`에 직접 복사했다. 변형 A의 질문은 거부되는지 하나뿐이다. Squirrel.Mac은 실행 중인 앱의 DR로 검증하므로 설치 경로와 상관없다.
  - 선택 단계(표준 계정, `~/Applications`, sha512 변조)는 하지 않았다.

### 변형 B: 성공

| 항목 | 결과 |
|---|---|
| 재실행과 버전 | 트레이 "업데이트 확인"부터 다운로드, Squirrel 검증, ShipIt 교체까지 이어졌다. 2.7초 뒤 0.0.2로 다시 떴다(`ppid 1`) |
| 새 번들 quarantine | 없다. `com.apple.provenance`만 있다. 처음 설치한 번들은 `01c1;…;Chrome`이었다 |
| Gatekeeper 대화상자 | 안 떴다 |
| 앱 수정 보호 알림 | 안 떴다. 시스템 로그에 이 앱이나 ShipIt의 `kTCCServiceSystemPolicyAppBundles` 요청이 없다 |
| 관리자 인증 | 없었다. `authd` 권한 요청 기록이 없다. 관리자 계정이 끌어다 놓은 번들(소유자 본인)이라 ShipIt이 그대로 옮겼다 |
| Keychain | 다시 물었다(아래) |
| 알림 권한 | 유지됐다. 권한 요청 배너 없이 바로 승인됐고, 시작 알림이 떴다 |
| 로그인 항목 | 유지됐다. 0.0.2가 시작할 때 `status: "enabled"`, `openAtLogin: true`였다 |
| App Translocation | 아니다. 실행 경로가 `/Applications/UpdateProbe.app/…`였다 |
| DR | 업데이트 뒤에도 `designated => identifier "app.example.updateprobe"`다 |

- ShipIt 로그(`~/Library/Caches/app.example.updateprobe.ShipIt/ShipIt_stderr.log`) 요지
  ```
  10:17:28.210 Beginning installation
  10:17:28.661 Moving bundle from file:///Applications/UpdateProbe.app/ to file:///var/folders/…/app.example.updateprobe.ShipIt.PZBP1KiJ/UpdateProbe.app
  10:17:28.661 Moving bundle from file:///var/folders/…/app.example.updateprobe.ShipIt.JQbPMx2p/UpdateProbe.app to file:///Applications/UpdateProbe.app/
  10:17:28.779 Installation completed successfully
  10:17:30.685 Successfully launched application at file:///Applications/UpdateProbe.app/
  ```
- 피드: electron-updater가 `localhost`의 302를 따라가, `127.0.0.1`에서 zip을 Range 없이 한 번에 받았다. 차등 다운로드는 꺼 두었다.

### 변형 A: 거부

- 업데이트를 확인하자 다운로드와 sha512 확인까지는 통과했다. 그다음 Squirrel.Mac이 앱 안 단계에서 거부했다. ShipIt은 돌지 않았고, 앱은 0.0.1로 계속 돌았다.
- `error` 이벤트 원문: `Code signature at URL file:///…/app.example.updateprobe.ShipIt/update.BeKtkZ9/UpdateProbe.app/ did not pass validation: 코드가 지정된 코드 요구 사항을 충족시키는데 실패함`
- 조사에서 예상한 문구와 같다. 기본 ad-hoc 서명의 DR은 cdhash라 빌드마다 바뀐다는 조사 전제가 맞았다.
- **사용자에게는 아무것도 보이지 않았다.** 창도 알림도 없이 끝났다. 사용자는 "추가로 업데이트 진행 여부를 알 수 있었으면 좋겠음"이라고 했다.

### Keychain

- **첫 실행(v0.0.1 처음 설치)에는 묻지 않았다.** 앱이 `UpdateProbe Safe Storage` 항목을 새로 만들었고, 14ms에 끝났다. [설정과 첫 실행 온보딩 결정](16-onboarding.md)의 추론이 맞았으므로 온보딩은 바꾸지 않는다.
- **업데이트 뒤 첫 실행에는 물었다.** `securityd`가 "ACL partition mismatch: client cdhash:70ab… ACL ("cdhash:ad9d…")"를 기록하고 창을 띄웠다. 명시 DR을 넣어도 파티션은 cdhash라는 조사의 추론과 맞다.
- **"허용"만 누르면 다음 실행에 또 묻는다.** "항상 허용"을 누르면 그 cdhash가 파티션 목록에 더해진다. 그 뒤로는 묻지 않았다(복호화 4ms).
- 사용자는 이 창을 **관리자 암호 창으로 읽었다.** Mac 로그인 암호를 넣는 창이라 그렇게 보인다.
- 다른 빌드로 바꿔 설치한 경우(변형 A로 교체)에도 같은 이유로 물었다. 사이트에서 받아 수동으로 업데이트해도 똑같이 묻는다.

### 알림 권한과 서명

- 변형 A로 바꾼 뒤에도 알림 권한을 다시 묻지 않았다. 서명도 DR도 다른 번들이었다. 이 Mac에서 알림 권한은 번들 ID에 붙는 것으로 보인다 [추론].

### 판정과 넘기는 것

- **macOS도 앱 내 업데이트(electron-updater + Squirrel.Mac)를 채택한다.** 조사 결론의 조건 5(ShipIt 설치·재실행, 앱 수정 보호 없음)가 이 Mac에서 충족됐다. 나머지 조건(최상위 명시 DR, 쓸 수 있는 설치 위치, App Translocation 아님)은 그대로다.
- [앱 내 업데이트 방식 결정](22-in-app-update-design.md)으로 아래 세 가지를 넘겼다. 자세한 내용은 그 티켓의 Comments에 있다.
  1. **진행과 실패 표시**: 서명 검증 실패는 화면에 아무것도 남기지 않는다.
  2. **DR 누락 방지**: 명시 DR이 빠진 버전이 한 번 나가면, 그 버전을 설치한 PC는 이후 업데이트가 모두 조용히 거부된다.
  3. **Keychain 안내 문구**: "항상 허용"을 눌러야 하고, 관리자 암호 창과 헷갈린다.

### 확인하지 못한 것

- 6절 선택 단계: 표준 계정의 관리자 인증 창, `~/Applications` 설치, sha512 변조 시 오류 경로
- 업데이트 뒤 실제로 로그아웃했다 로그인할 때 자동 시작되는지. 상태 값(`enabled`)만 봤다.
- 실제 GitHub Release와 Vercel 경로. 로컬 서버로 흉내만 냈다.
- 같은 번들 ID로 ad-hoc 서명한 다른 번들이 알림 권한이나 TCC 허용을 물려받는지
- Intel Mac, Windows

## Comments

- 2026-10-18, [설정과 첫 실행 온보딩 결정](16-onboarding.md)에서 덧붙인다.
  - 기록할 것에 하나를 더한다. **첫 실행(v0.0.1 처음 설치)에서 키체인을 묻는지**를 남긴다.
  - 온보딩은 "첫 실행에는 묻지 않는다"는 추론을 전제로 키체인 설명을 업데이트 직전으로 미뤘다. 첫 실행에도 묻는 것으로 나오면 키 입력 칸의 [확인] 옆에 같은 안내를 넣는다.
