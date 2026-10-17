# 앱 내 업데이트 가능성 조사

Map: [Flow 멘션 답변 초안 앱](../map.md)
Type: research
Mode: AFK
Status: resolved
Blocked by:

## Question

ad-hoc 서명한 macOS 앱과 미서명 Windows 앱에서, **앱 안에서 새 버전을 받아 설치하고 다시 실행하는 업데이트**가 가능한지 1차 출처로 확인한다.

사용자가 [다운로드 사이트 형태 결정](09-download-site.md)에서 이렇게 물었다. "다른 앱들은 앱 안에서 업데이트하고 자동으로 다시 실행되던데, 그건 안 되는가?" 지도의 Out of scope에는 "앱 내 자동 업데이트"가 있다. 이 조사는 이 항목을 범위 안으로 되돌릴지 판단하는 근거다.

**전제**: Electron 44, electron-builder 26.17.0, macOS arm64 DMG(ad-hoc 서명), Windows x64 NSIS 원클릭(미서명). Release는 비공개 저장소 `stardraft`에 있고, Vercel 함수가 서명된 임시 URL(약 55분 유효)로 302 리디렉트해 파일을 내보낸다.

## Answer

2026-10-17에 조사를 마쳤다. 자세한 근거는 [앱 내 업데이트 가능성 조사](../research/in-app-update.md)에 있다. 이 Mac에서 직접 확인한 것은 designated requirement(DR) 검증, quarantine 여부, GitHub 자산 호스트의 Range 응답까지다. 실제 업데이트 설치와 재실행은 실험 설계만 했다(조사 문서 6절).

- **macOS: 조건부로 가능하다.**
  - 지금 설정인 기본 ad-hoc 서명으로는 안 된다. ad-hoc의 DR은 빌드마다 바뀌는 `cdhash H"…"`이고, Squirrel.Mac은 설치된 앱의 DR로 새 번들을 검증한다. 같은 검증 API로 돌리면 `-67050`으로 실패했다(실측).
  - `afterSign` 훅에서 **최상위 번들만** `designated => identifier "app.squadify.stardraft"`로 다시 서명하면 검증을 통과했다(실측). `mac.requirements`는 중첩 코드까지 깨뜨리므로 쓰지 않는다(실측).
  - 남는 조건은 넷이다.
    - 명시 DR이 든 첫 버전은 사이트에서 한 번 수동으로 설치해야 한다.
    - 앱이 쓸 수 있는 위치에 있어야 한다. 표준 계정이 쓰는 `/Applications`의 앱은 업데이트할 때마다 관리자 인증을 요구한다.
    - App Translocation 상태가 아니어야 한다.
    - 실기 실험에서 설치와 재실행이 되고, 앱 수정 보호에 막히지 않아야 한다. 아직 확인하지 않았다.
  - Keychain 재허용은 업데이트마다 그대로 남는다.
- **Windows: 가능하다.** 근거는 문서와 소스이고, 실기는 확인하지 않았다.
  - 미서명 빌드는 `publisherName`이 없어서 서명 검증을 건너뛴다.
  - `quitAndInstall(true, true)`가 조용히 설치하고 다시 실행한다. 사용자별 설치라 UAC가 뜨지 않는다.
  - 앱이 받은 파일에는 Mark of the Web이 붙지 않으므로 SmartScreen 경고가 뜨지 않을 것으로 본다(추론).
- **공통**
  - 앱이 받은 파일에는 quarantine이 붙지 않는다(실측). 그래서 업데이트할 때는 Gatekeeper나 SmartScreen의 사람 확인 없이 모든 PC에 퍼진다. 진위 확인은 앱이 따로 해야 한다.
  - macOS는 zip 산출물이 필요하다.
  - electron-updater는 Vercel의 302 리디렉트를 따라간다(실측).
  - GitHub 자산 호스트는 다중 Range 요청을 `501`로 거부한다(실측). 그래서 `useMultipleRangeRequest: false`를 주거나, 처음에는 차등 다운로드를 끈다.
- **추천 방식**
  - 두 OS 모두 electron-updater와 generic provider를 쓰고, 피드 주소는 Vercel 함수로 둔다.
  - macOS는 위의 명시 DR로 다시 서명한다.
  - 앱은 업데이트 파일의 Ed25519 서명을 검증한 뒤에만 설치한다.
  - 트레이 메뉴에 "재시작해서 업데이트"를 둔다.
  - 채택하기 전에 조사 문서 6절의 실험을 먼저 돌린다.
- **범위 판단**은 [다운로드 사이트 형태 결정](09-download-site.md)에서 사용자와 정한다.
