# 다운로드 사이트 UI/UX 사례 조사

- 조사일: 2026-10-16
- 티켓: [다운로드 사이트 UI/UX 사례 조사](../issues/18-download-site-ux-research.md)
- 이 문서를 근거로 쓰는 곳: [다운로드 사이트 화면 프로토타입](../issues/19-download-site-prototype.md)
- 전제
  - `Stardraft`는 macOS arm64 DMG(ad-hoc 서명, 공증 없음, macOS 13 이상)와 Windows x64 NSIS 원클릭 설치 파일(미서명, Windows 10 이상)로 배포한다.
  - 그래서 설치할 때 macOS는 "열지 않음 → 시스템 설정 > 그래도 열기", Windows는 "Windows의 PC 보호 → 추가 정보 → 실행"을 거친다. 사이트의 핵심 목적은 이 경고를 넘겨 설치를 마치게 돕는 것이다.
  - 비교 기준은 [다운로드 사이트 형태 결정](../issues/09-download-site.md)에서 정한 내용 8가지다. 소개, OS별 다운로드와 지원 환경, 준비물, OS별 설치 안내, 업데이트, 변경 내역, 이전 버전과 SHA256, 삭제.
  - 사용자는 "인터랙티브"를 설치를 돕는 상호작용과 시각 연출 **둘 다**로 정했다.
  - OS 경고 자체(Gatekeeper, SmartScreen, 스마트 앱 컨트롤)의 사실과 안내문 초안은 [트레이 앱 조사 7절](tray-app-framework.md#7-미서명-배포-경험)에 있다. 여기서는 다시 조사하지 않았다.
- 조사 방법
  - Playwright 1.56.1로 Google Chrome을 headless로 띄워 각 사이트를 열었다.
    - 데스크톱: 1440×900, macOS Chrome UA, Client Hints `architecture: arm`
    - 모바일: 390×844, DPR 2, iPhone Safari UA, 터치 켬
  - 스크린숏은 **첫 화면(viewport)만** 저장했다. 전체 페이지는 분석용으로만 찍었다. 일부는 설치 안내 위치로 스크롤하거나, 페이지 안 모달·펼침을 연 상태를 따로 찍었다.
  - **OS·칩 감지**: CDP `Emulation.setUserAgentOverride`로 UA와 `userAgentMetadata`를 바꿔 네 프로필로 열었다. 대표 버튼의 글자와 링크를 비교했다.
    - macOS Chrome(arm), macOS Chrome(x86), macOS Safari(Client Hints 없음), Windows Chrome(x86, 64bit)
  - **모션**
    - `document.getAnimations()`로 CSS 애니메이션 수와 무한 반복 여부를 셌다.
    - `video`, `canvas` 요소를 셌다.
    - 첫 화면을 1.5초 간격으로 두 번 찍어 픽셀이 바뀌는지 봤다.
    - `prefers-reduced-motion: reduce`를 에뮬레이션해 같은 측정을 반복했다.
  - **안전**
    - 다운로드 버튼은 누르지 않았다. 설치 파일 요청은 Playwright route에서 끊고, `acceptDownloads: false`로 열었다. 브라우저 대화상자는 자동으로 닫게 했다.
    - 누른 것은 탭, 드롭다운, 버전 펼침, 페이지 안 모달을 여는 버튼(Raycast의 "Install via Homebrew", "Download V1")뿐이다. 두 버튼은 HTML 모달만 열었고 다운로드는 일어나지 않았다.
    - 다운로드 링크의 리디렉트 대상은 `curl -sI`로 헤더만 받아 확인했다. Zed의 다운로드 후 페이지는 HTML만 받아 글을 읽었다.
  - 표기
    - [관측]: 화면에서 직접 본 것
    - [측정]: 위 스크립트의 결과
    - [문서]: 사이트 글 원문
    - [추론]: 위 결과에서 끌어낸 판단
  - 한계
    - headless Chrome 결과다. 실제 브라우저, 실제 Windows·Safari와 다를 수 있다. UA만 바꿨고 OS는 macOS 그대로다.
    - Cursor는 첫 시도에서 Windows·Safari 프로필이 Vercel 보안 검사("Failed to verify your browser")에 막혔다. 다시 열어 확인했다.
    - 영상(Raycast Windows 페이지의 "Watch Guide")은 재생하지 않았다. 스크롤 연동 모션은 천천히 내려 보며 일부만 봤다.
    - 열람은 2026-10-16 밤(KST)에 했다. 일부 재확인은 자정 직후에 했다.

## 고른 10곳

| # | 분류 | 사이트 | 고른 이유 |
|---|---|---|---|
| 1 | 메뉴바·트레이 | Raycast | OS 감지 버튼, 지원 환경 한 줄, 구버전 모달까지 갖춘 대형 메뉴바 앱. 시각 연출이 가장 많다 |
| 2 | 메뉴바·트레이 | Rectangle | 버튼 하나와 지원 환경 한 줄로 끝나는 가장 단순한 소형 앱 사이트. 사이트 안 버전 목록이 있다 |
| 3 | 메뉴바·트레이 | Maccy | 소형 앱. 사칭 사이트 경고 띠와 제품 시연 영상을 쓴다 |
| 4 | 메뉴바·트레이 | Espanso | macOS 메뉴바·Windows 트레이 앱. OS 감지 버튼과 **SmartScreen 그림 안내**가 있다 |
| 5 | 미서명 오픈소스 | Stretchly | Electron 트레이 앱이고 macOS는 ad-hoc 서명이다. Stardraft와 조건이 가장 가깝다 |
| 6 | 미서명 오픈소스 | Flameshot | 메뉴바·트레이 앱. macOS 미서명 경고를 **번호 단계 7개**로 안내한다 |
| 7 | 미서명 오픈소스 | AeroSpace | 공증하지 않는 이유를 밝히고, quarantine 해제를 Homebrew와 수동으로 나눠 안내한다 |
| 8 | AI·개발 도구 | Cursor | Client Hints로 Mac 칩을 가른다. 다운로드 페이지 안에 이전 버전 6개를 펼침으로 둔다 |
| 9 | AI·개발 도구 | LM Studio | "OS·칩·버전" 선택 상자를 문장처럼 배치했다. 모바일에서는 "링크 복사"로 바꾼다 |
| 10 | AI·개발 도구 | Zed | 버전·날짜·변경 내역이 다운로드 위에 있다. OS마다 칩 선택이 있고, 릴리스 페이지에서 이전 버전을 받는다 |

- 후보로 열어 보고 뺀 곳
  - Ollama: OS 탭(macOS·Linux·Windows)과 복사 버튼뿐이라 Rectangle·Zed와 겹친다. Windows UA에서는 "Download manually"가 `OllamaSetup.exe`로 바뀌었다 [측정].
  - Claude 데스크톱: Windows UA에서 "Download for Windows"와 보조 링크 "Windows (arm64)"가 나왔다. iPhone에서는 "Download iOS app"으로 바뀌었다 [측정]. 앱 성격이 달라 뺐다.
  - Pinokio: Client Hints가 없는 UA에서 "Looks like Intel. If not, pick the other build."라고 추측을 글로 보여 줬다 [관측]. 좋은 문구라 패턴 정리에만 인용한다.
  - Ice, Stats: Ice 사이트와 Stats README에서 설치 경고 안내를 찾지 못했다 [관측]. 메뉴바 분류는 위 4곳으로 충분했다.

## 한눈에 보기

### 감지·설치 안내·모션

| 사이트 | OS 감지 | 칩 감지 | 경고 안내 형태 | 설명 모션 | 장식 모션 | reduce 존중 |
|---|---|---|---|---|---|---|
| Raycast | UA로 Mac·Windows 버튼 교체 | 없음. Mac 링크는 `architecture=arm64` 고정 | 없음 | 제품 창의 깜박이는 커서 | 히어로 canvas 빛줄기, 등장 애니메이션, 회전 테두리 | 안 함 |
| Rectangle | 없음(Mac 전용) | 없음. 유니버설 | 없음 | 없음 | 없음 | 해당 없음 |
| Maccy | 없음(Mac 전용) | 없음 | 없음 | 제품 시연 영상 반복 재생 | 없음 | 안 함(영상 계속 재생) |
| Espanso | UA로 "Get Started on <OS>" 교체 | 없음. 유니버설 | Windows SmartScreen 번호 그림 1장 | 히어로 타이핑 시연 | 입자 연결선 canvas, 등장 페이드 | 안 함 |
| Stretchly | 없음. OS별 절 | 없음. 수동 선택 | 글. Open Anyway와 `xattr` | 없음 | 없음 | 해당 없음 |
| Flameshot | 없음. 홈 탭은 늘 Windows | 없음 | macOS 번호 단계 7개, 권한 그림 1장 | 없음 | 없음 | 해당 없음 |
| AeroSpace | 해당 없음(Mac 전용) | 해당 없음 | 글. `xattr` 또는 우클릭 열기 | 없음 | 없음 | 해당 없음 |
| Cursor | UA로 Mac·Windows 버튼 교체 | **Client Hints로 arm64·유니버설 구분** | 없음 | 에이전트 데모 카드 | 작은 시트 등장 | 안 함(데모 계속) |
| LM Studio | UA로 선택 상자 기본값 | 선택 상자("M series"만) | 없음 | 없음 | 없음 | 해당 없음 |
| Zed | 모든 OS를 한 번에 표시 | Windows 칩만 힌트를 따름 | 없음 | 없음 | 아이콘 위 노이즈 canvas | 안 함 |

### 09 내용 요건 대비

✓ 있음, △ 일부나 외부 링크, ✗ 없음. 다운로드·설치 페이지 기준이다.

| 사이트 | 소개 | 다운로드·지원 환경 | 준비물 | 설치 안내 | 업데이트 | 변경 내역 | 이전 버전 | SHA256 | 삭제 |
|---|---|---|---|---|---|---|---|---|---|
| Raycast | ✓ | ✓ | ✗ | △ Homebrew 모달 | ✗ | △ 별도 페이지 | △ V1 모달 | ✗ | ✗ |
| Rectangle | ✓ | ✓ | ✗ | ✗ | ✗ | △ `/versions` | △ 3개와 구형 OS용 1개 | ✗ | ✗ |
| Maccy | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Espanso | ✓ | ✓ | △ Linux 환경 판별법 | ✓ | ✗ | ✗ | ✗ | △ Linux만 | ✗ |
| Stretchly | ✓ | ✓ | ✗ | △ 글 | ✓ brew·choco | △ 블로그 | △ GitHub | ✗ | △ brew만 |
| Flameshot | ✓ | ✓ | ✗ | ✓ macOS | ✗ | ✗ | △ GitHub | ✗ | ✗ |
| AeroSpace | △ README | △ GitHub | ✗ | ✓ | △ brew 자동 | ✗ | △ brew 고정 버전 | ✗ | ✗ |
| Cursor | ✓ | ✓ | ✗ | ✗ | ✗ | ✓ | ✓ 6개 | ✗ | ✗ |
| LM Studio | ✓ | ✓ | ✗ | ✗ | ✗ | ✓ | ✗ 현재 버전만 | ✗ | ✗ |
| Zed | ✗ | ✓ | ✗ | ✗ | ✗ | ✓ | ✓ 릴리스 페이지 | ✗ | ✗ |

- 8가지를 한 페이지에 모두 담은 곳은 없다.
- SHA256은 10곳 모두 다운로드 페이지에 없다. Espanso만 Linux 문서에 "VERIFYING PACKAGE CHECKSUM" 상자를 뒀다 [관측].
- 업데이트할 때 경고를 다시 받는다는 안내, 스마트 앱 컨트롤 확인 안내는 10곳 모두 없다 [관측].

## 1. Raycast

- URL: <https://www.raycast.com/> (조회 2026-10-16)
- 스크린숏: [데스크톱](download-site-ux/raycast-desktop.png), [모바일](download-site-ux/raycast-mobile.png), [Homebrew 모달](download-site-ux/raycast-homebrew-modal-desktop.png), [V1 모달](download-site-ux/raycast-v1-modal-desktop.png)
- **첫 화면** [관측]
  - 검은 바탕 위로 빨간 빛줄기 그림이 화면 대부분을 덮는다. 가운데 큰 제목 "Your shortcut to everything."이 있다.
  - 맨 아래 "Download for Mac" 버튼, 그 밑에 고정폭 글꼴로 "macOS Tahoe and Apple Silicon required", 다시 그 밑에 "Install via Homebrew | Download V1"이 있다.
  - 헤더는 둥근 테두리를 두른 떠 있는 띠다.
- **OS·칩 감지** [측정]
  - Windows UA에서는 버튼이 "Download for Windows"(`/download/windows`)로, 보조 링크가 "Install via WinGet"으로 바뀐다. 세 Mac 프로필은 모두 "Download for Mac"이다.
  - `/download/mac`은 `x.raycast-releases.com/download/web?platform=macos&architecture=arm64`로 307 리디렉트한다. 칩 힌트가 없어도 arm64다.
  - 감지가 틀렸을 때: 헤더의 "Windows" 링크로 Windows 페이지에 간다. Intel Mac은 "Download V1"을 누르면 모달이 뜬다. 원문: "Raycast V1 is the previous version of Raycast for macOS. Download it if you're using an Intel Mac or running macOS 13, 14 or 15." [문서]
- **설치 안내** [관측]
  - 단계 안내는 없다. "Install via Homebrew"를 누르면 페이지 안 모달이 뜬다. 제목, 한 문장, `brew install --cask …` 명령과 복사 아이콘, "Close" 버튼이 있다.
  - Windows 페이지(<https://www.raycast.com/windows>)에는 Microsoft Store 배지, "Watch Guide" 버튼, "v2.8.2.0 | Windows 10+ | Install via WinGet" 줄이 있다. 영상은 재생하지 않았다.
- **상호작용과 모션** [측정]
  - 설치를 돕는 상호작용: Homebrew 명령 복사 모달, 구버전 확인 모달
  - 설명 모션: 제품 창 그림 속 깜박이는 커서 4개(무한 반복). 입력을 흉내 낸다.
  - 장식 모션: 히어로 canvas(1200×967)가 계속 바뀐다. 제목 `fade-in-up`, 히어로 아래 "The Raycast Keyboard" 알약 버튼의 `conic-gradient` 테두리 회전(무한 반복), 확장 카드 `slideIn` 여러 개
  - reduce: 무한 애니메이션 8개가 그대로 돌고, 첫 화면 픽셀도 계속 바뀌었다.
- **버전·변경 내역·이전 버전**
  - Mac 홈에는 버전 숫자가 없다. Windows 페이지에는 있다 [관측].
  - 변경 내역은 `/changelog`(macOS)와 `/changelog/windows`가 따로 있다. 최신 항목은 v2.8(2026-10-16)이다 [관측].
  - 이전 버전은 V1 하나만 모달로 준다.
- **모바일** [관측]
  - 다운로드 버튼이 사라진다. 첫 화면은 빛줄기 그림과 제목, "The Raycast Keyboard" 링크뿐이다. 페이지 높이는 15,646px다 [측정].
- **Stardraft에 주는 점**
  - 버튼 밑 지원 환경 한 줄과, 지원하지 않는 환경에 이유를 붙인 확인 모달은 쓸 만하다.
  - 빛줄기 배경, 떠 있는 헤더, 회전 테두리는 `ui-design` 금지 항목에 걸린다.

## 2. Rectangle

- URL: <https://rectangleapp.com/>, <https://rectangleapp.com/versions> (조회 2026-10-16)
- 스크린숏: [데스크톱](download-site-ux/rectangle-desktop.png), [모바일](download-site-ux/rectangle-mobile.png)
- **첫 화면** [관측]
  - 흰 바탕 가운데 큰 앱 아이콘, 이름, 한 줄 설명, 테두리만 있는 둥근 "DOWNLOAD" 버튼이 있다.
  - 그 밑에 "Free and Open Source, Supports macOS 10.15+, Intel and Apple Silicon".
  - 바로 아래 어두운 띠가 유료판(Rectangle Pro)을 권한다.
- **OS·칩 감지** [측정]: 없다. 네 프로필 모두 같은 링크(`github.com/rxhanson/Rectangle/releases/download/v2.0.3/Rectangle2.0.3.dmg`)다. 유니버설 빌드 하나라 필요가 없다.
- **설치 안내**: 없다. 버튼이 GitHub Release 파일로 바로 간다.
- **상호작용과 모션** [측정]: 상호작용 없음. CSS 애니메이션 0개, 영상·canvas 0개. 첫 화면은 정지해 있다.
- **버전·변경 내역·이전 버전** [관측]
  - 홈에는 버전이 없다. 맨 아래 "Recent versions (and older macOS support)" 링크가 `/versions`로 간다.
  - `/versions`는 2.0.3(Current Version), 2.0.2, 1.100 세 개를 변경 내용 몇 줄과 "Details" 링크로 보여 준다. 끝에 "For macOS 10.13.6 users: 0.73"이 있다.
- **모바일** [관측]: 한 단 배치로 무난하다. 다만 앱 아이콘이 가운데가 아니라 오른쪽으로 치우친다.
- **Stardraft에 주는 점**: 지원 환경 한 줄과 "구형 OS용은 이것" 한 줄은 그대로 쓸 만하다. 대문자 자간 버튼은 피한다.

## 3. Maccy

- URL: <https://maccy.app/> (조회 2026-10-16)
- 스크린숏: [데스크톱](download-site-ux/maccy-desktop.png), [모바일](download-site-ux/maccy-mobile.png)
- **첫 화면** [관측]
  - 맨 위 분홍 띠: "Beware of fake websites impersonating Maccy. maccy.app is the only official website."
  - 왼쪽에 아이콘과 큰 이름, 두 줄 설명, "Get in App Store"(채운 버튼)와 "Download now"(테두리 버튼), 그 밑에 "Requires macOS Sonoma 14 or higher". 오른쪽에 메뉴 드롭다운 시연 영상이 있다.
  - 오른쪽 위 모서리에 "Fork me on GitHub" 리본이 있다.
- **OS·칩 감지** [측정]: 없다. "Download now"는 Gumroad(`gum.co/Apsra`)로 간다.
- **설치 안내**: 없다.
- **상호작용과 모션** [측정]
  - 설명 모션: `Demo.webm` 영상(autoplay, loop, muted). 메뉴바 드롭다운을 여는 모습을 보여 준다.
  - 장식 모션: 없다.
  - reduce: 영상이 그대로 자동 재생됐다.
- **버전·변경 내역·이전 버전**: 사이트에 없다. GitHub 링크만 있다 [관측].
- **모바일** [관측]: 경고 띠가 3줄로 커진다. 버튼 두 개가 세로로 쌓이고 영상은 그 아래로 간다.
- **Stardraft에 주는 점**
  - "이 주소에서 받은 파일만 설치하라"는 신뢰 문구를 첫 화면에 두는 방식은 미서명 앱에 맞는다.
  - "NO FLUFF" 같은 대문자 소제목과 리본은 피한다.

## 4. Espanso

- URL: <https://espanso.org/>, <https://espanso.org/install/>, <https://espanso.org/docs/install/win/>, <https://espanso.org/docs/install/mac/> (조회 2026-10-16)
- 스크린숏: [홈 데스크톱](download-site-ux/espanso-desktop.png), [홈 모바일](download-site-ux/espanso-mobile.png), [Windows 설치 문서 데스크톱](download-site-ux/espanso-install-win-desktop.png), [Windows 설치 문서 모바일](download-site-ux/espanso-install-win-mobile.png)
- **첫 화면** [관측]
  - 흰 바탕에 청록 점과 선이 이어진 그물 그림이 깔려 움직인다. 큰 제목 "Supercharge your typing experience."에서 커서가 깜박인다.
  - 그 밑에 두 줄 설명, "Get Started on macOS" 버튼, "Also available on Windows and Linux" 링크가 있다.
  - 3.5초 뒤 캡처에서도 버튼과 링크가 반투명했다. 등장 애니메이션(react-reveal)이 끝나지 않은 상태다.
- **OS·칩 감지** [측정]
  - Windows UA: "Get Started on Windows"(`/docs/install/win/`)와 "Also available on macOS and Linux"
  - Mac 세 프로필: "Get Started on macOS"(`/docs/install/mac/`)
  - iPhone: "Get Started"(`/install/`)와 "Available on macOS, Windows and Linux"
  - 감지가 틀렸을 때: 버튼 바로 밑 "Also available on …" 링크가 OS 선택 페이지(`/install/`)로 간다. 이 페이지는 "Select your operating system:" 아래 Windows·macOS·Linux 묶음으로 파일을 나눈다.
- **설치 안내** [문서·관측]
  - macOS 문서: DMG를 열어 앱을 `/Applications`로 끌어다 놓으라는 한 문장과 Homebrew 명령. 경고 안내는 없다. macOS판은 서명돼 있다고 본다 [추론].
  - Windows 문서: "Espanso is compatible with Windows 10 or later, currently only on x64 architecture." 설치 파일·zip 버튼, winget·Chocolatey·Scoop 명령(복사 버튼)이 있다.
  - "Problems you may experience" 절: "Given that Espanso's digital signature is still relatively new, you may experience a warning from Windows Smartscreen. In this case, just click on "More info" (1) and then on "Run anyway" (2), as shown in the picture:"
  - 그림은 SmartScreen 대화상자 **두 상태를 나란히** 둔다. 왼쪽은 "More info"에 초록 상자와 화살표 "1", 오른쪽은 "Run anyway"에 초록 상자와 화살표 "2"다.
  - 그림 속 파일명은 `espanso-win-0.1.0.exe`다. 옛 버전 화면을 계속 쓰고 있다.
  - 서명은 했지만 평판이 쌓이지 않아 경고가 뜬다고 설명한다. 미서명은 아니다.
- **상호작용과 모션** [측정]
  - 설치를 돕는 상호작용: OS별 버튼, 명령 복사 버튼, 문서 오른쪽의 "이 페이지에서" 목차
  - 설명 모션: 히어로와 "How it works"의 타이핑 시연. 키워드를 치면 문장으로 바뀌는 것을 보여 준다.
  - 장식 모션: 화면 전체 canvas(1440×900)의 입자 그물, 문단·버튼의 등장 페이드
  - reduce: 애니메이션 7개(무한 4개)가 그대로였고 첫 화면 픽셀도 계속 바뀌었다.
- **버전·변경 내역·이전 버전** [관측]: 다운로드·설치 페이지에 버전 숫자가 없다. 문서 상단에 문서 판(`v2`) 선택만 있다.
- **모바일** [관측]
  - 홈: 그물 그림이 그대로 깔리고 "Get Started" 버튼이 흐리게 보인다.
  - Windows 문서: 두 대화상자 그림이 화면 폭에 맞게 줄어 그림 속 글자는 읽기 어렵다. 번호와 초록 상자는 보인다.
- **Stardraft에 주는 점**
  - 번호와 강조 상자를 붙인 2상태 대화상자 그림은 Windows 안내에 그대로 가져올 만하다.
  - CTA를 늦게 드러내는 등장 애니메이션과 입자 배경은 피한다.

## 5. Stretchly

- URL: <https://hovancik.net/stretchly/downloads/> (조회 2026-10-16)
- 스크린숏: [데스크톱](download-site-ux/stretchly-desktop.png), [모바일](download-site-ux/stretchly-mobile.png)
- **첫 화면** [관측]
  - 어두운 바탕의 개인 사이트 한 단 글이다. 위에 저자 이름과 앱 소개, 메뉴 링크 줄이 있다.
  - "Downloads" 제목 옆에 다운로드 수 배지가 있고, 바로 macOS 절로 들어간다.
- **OS·칩 감지** [측정]: 없다. macOS, Windows, Linux 절을 차례로 둔다.
  - macOS는 "Download the DMG file or Arm64 DMG file."로 사용자가 고른다. 모르면 "Not sure which chip your computer has? Here's how to tell." 링크가 Apple 안내로 간다 [문서].
- **설치 안내** [문서]
  - "Requires macOS Monterey (12) or later."
  - Homebrew tap 설치를 권한다. 이어서 경고 안내: "macOS Gatekeeper may block the app on its first launch, showing an "unidentified developer" warning. To bypass this, go to System Settings > Privacy & Security, scroll down, and click Open Anyway next to the Stretchly alert. Alternatively, locate the app in Finder, Control-click (or Right-click) its icon, and select Open."
  - "Application Signing" 절: "Stretchly is not signed (due to its costs and me not owning supported Apple device) so you will need to use a workaround for the first run."
    - Intel: Apple 안내 "Open a Mac app from an unidentified developer" 링크
    - Apple Silicon: `sudo xattr -r -d com.apple.quarantine /Applications/Stretchly.app`
  - GitHub README는 같은 상태를 "only ad-hoc signed"라고 적는다. 사이트는 "not signed"라고 적는다.
  - Windows 절: 설치 파일 링크, Chocolatey, winget, Microsoft Store, 무인 설치 명령. **SmartScreen 언급이 없다.**
  - 스크린숏은 없다.
- **업데이트와 삭제** [문서]
  - "When upgrading, run the following command. Don't forget to Quit Stretchly, first." 다음에 `brew upgrade --cask hovancik/stretchly/stretchly`
  - 삭제: `brew uninstall --cask hovancik/stretchly/stretchly`, `brew untap hovancik/stretchly`
  - Windows는 `choco upgrade stretchly`만 있다.
- **상호작용과 모션** [측정]: 없다. 애니메이션 0개. 명령 상자에 복사 버튼도 없다.
- **버전·변경 내역·이전 버전** [관측]: 버전은 파일 링크 이름(`Stretchly-1.22.1-arm64.dmg`)에만 있다. 전체 목록은 GitHub Releases로, 소식은 블로그(News)로 보낸다.
- **모바일** [관측]: 글이 그대로 접혀 읽기 쉽다. 가로 넘침 없음 [측정].
- **Stardraft에 주는 점**
  - 서명하지 않은 이유를 한 문장으로 밝히는 것, 업데이트 전 앱 종료와 삭제 명령까지 적은 것은 가져올 만하다.
  - macOS 15부터 막힌 "우클릭 > 열기"를 대안으로 남겨 둔 것, 칩별로 다른 우회법을 준 것은 피한다. Apple 안내는 칩과 무관하게 "그래도 열기"다 ([Apple 개발자 뉴스](https://developer.apple.com/news/?id=saqachfa), [Safely open apps on your Mac](https://support.apple.com/en-us/102445)).

## 6. Flameshot

- URL: <https://flameshot.org/docs/installation/installation-osx/>, <https://flameshot.org/docs/installation/installation-windows/>, <https://flameshot.org/> (조회 2026-10-16)
- 스크린숏: [데스크톱(macOS 설치 문서)](download-site-ux/flameshot-desktop.png), [모바일](download-site-ux/flameshot-mobile.png)
- **첫 화면** [관측]
  - 문서 사이트 3단 배치다. 왼쪽 문서 목차, 가운데 본문, 오른쪽 "ON THIS PAGE".
  - 본문 첫 화면에 MacPorts·Homebrew 명령과 경고 안내 번호 목록이 바로 보인다.
- **OS·칩 감지** [측정]
  - 문서: 없다. OS마다 문서가 따로 있다.
  - 홈의 "Download Flameshot" 절은 Windows·macOS·Linux 탭이다. Mac UA와 Windows UA 모두 **Windows 탭이 기본**이었다.
  - macOS 파일은 `Flameshot-14.0-macos-arm64.dmg` 하나다.
- **설치 안내** [문서]
  - "If you see the message "flameshot" cannot be opened because the developer cannot be verified. you will need to follow the steps below:"
    1. Applications 폴더로 간다.
    2. `flameshot.app`을 우클릭해 Open을 고른다.
    3. 대화상자에서 Open을 누른다.
    4. "Click Done - don't move to trash"
    5. "Go to Settings > Privacy & Security and scroll down until you see Flameshot was blocked, and click Open Anyway"
    6. 화면 녹화 권한을 요청하는 대화상자가 뜬다.
    7. 시스템 설정의 "Screen & System Audio Recording"에서 Flameshot 토글을 켠다.
  - 끝에 "After following all those steps above, you should see the Flameshot icon in the menubar"로 완료 상태를 알려 준다.
  - 그림은 7단계의 권한 설정 화면 1장뿐이다. 경고 대화상자 그림은 없다.
  - Windows 문서: winget·Scoop·Chocolatey 명령과, GitHub Release 화면에서 Assets를 찾는 3단계에 그림 3장. SmartScreen 언급은 없다.
- **상호작용과 모션** [측정]: 없다. 애니메이션 0개.
- **버전·변경 내역·이전 버전** [관측]: 홈 버튼에는 버전이 안 보이고 링크(`v14.0.0`)에만 있다. 탭마다 "Looking for older releases?"가 GitHub Releases로 간다.
- **모바일** [관측]: 목차가 햄버거 메뉴로 접힌다. 본문의 인라인 코드가 여러 줄로 끊겨 읽기 불편하다.
- **Stardraft에 주는 점**
  - "완료를 누르고 휴지통으로 옮기지 말라"처럼 사람이 실수하는 지점을 단계로 적은 것, 마지막에 "메뉴바에 아이콘이 보이면 끝"이라고 완료 기준을 준 것은 가장 쓸 만하다.
  - 2~3단계의 우클릭 열기는 macOS 15부터 통하지 않는 옛 경로다. OS와 무관하게 Windows 탭을 기본으로 여는 것도 피한다.

## 7. AeroSpace

- URL: <https://nikitabobko.github.io/AeroSpace/guide#installation>, <https://github.com/nikitabobko/AeroSpace> (조회 2026-10-16)
- 스크린숏: [데스크톱(가이드 1절)](download-site-ux/aerospace-desktop.png), [모바일](download-site-ux/aerospace-mobile.png)
- **첫 화면** [관측]: 긴 단일 문서다. 왼쪽 고정 목차, 오른쪽 본문. 앵커로 열면 "1. Installation"이 첫 화면이다.
- **OS·칩 감지**: 해당 없음. macOS 전용 zip 하나다.
- **설치 안내** [문서]
  - README: "By using AeroSpace, you acknowledge that it's not notarized." 이어서 공증을 하지 않는 이유와, Homebrew 설치 스크립트가 `com.apple.quarantine` 속성을 지워 경고 없이 열린다는 설명이 있다.
  - 가이드 1.1 Homebrew(권장): 명령 하나. 특정 이전 버전은 `aerospace@0.12.0`처럼 고정해 설치한다고 적는다.
  - 가이드 1.2 수동 설치: 4단계(zip 받기, 풀기, `/Applications`에 두기, 선택 사항인 CLI PATH 추가)
  - 경고 문구를 그대로 인용한 뒤 해결법 두 개를 준다.
    - Option 1: `xattr -d com.apple.quarantine /Applications/AeroSpace.app`
    - Option 2: Finder에서 우클릭 > "Open (yes, it's that stupid)"
  - 스크린숏은 없다.
- **상호작용과 모션** [측정]: 없다. 명령 상자에 복사 버튼도 없다.
- **버전·변경 내역·이전 버전**: README는 Homebrew로 설치하면 "autoupdates"가 된다고 적는다 [문서]. 변경 내역은 GitHub Releases다.
- **모바일** [관측]: 앵커로 열면 1절이 바로 보인다. 긴 명령은 코드 상자 안에서 잘린다(상자 안 가로 스크롤). 페이지 전체 높이는 43,677px다 [측정].
- **Stardraft에 주는 점**
  - 화면에 뜨는 경고 문구를 그대로 인용해 "이 문구가 보이면"으로 시작하는 방식은 찾기 쉽다.
  - Option 2는 macOS 15부터 통하지 않는다. 비꼬는 말투는 사내 도구에 맞지 않는다.

## 8. Cursor

- URL: <https://cursor.com/download> (조회 2026-10-16)
- 스크린숏: [데스크톱](download-site-ux/cursor-desktop.png), [모바일](download-site-ux/cursor-mobile.png), [이전 버전 펼침](download-site-ux/cursor-versions-desktop.png)
- **첫 화면** [관측]
  - "Use Cursor everywhere you work" 제목 밑에 Desktop·Terminal·Web 카드 3장이 나란히 있다. 카드마다 움직이는 제품 그림과 버튼(Desktop은 "Download for macOS")이 있다.
  - 오른쪽 아래 쿠키 동의 상자가 카드 일부를 덮는다.
  - 아래로 "The Cursor desktop app is available for macOS, Windows, and Linux."와 버전 목록이 이어진다.
- **OS·칩 감지** [측정]
  - Mac(arm 힌트): `darwin-arm64`
  - Mac(x86 힌트)과 Safari(힌트 없음): `darwin-universal`
  - Windows: "Download for Windows" → `win32-x64-user`(사용자 설치판)
  - iPhone: "Download for macOS" → `darwin-universal`
  - [추론] high-entropy Client Hints(`architecture`)로 Apple Silicon을 가르고, 판별하지 못하면 어느 칩에서도 도는 유니버설로 물러난다.
  - 감지가 틀렸을 때: 바로 아래 "3.24 Latest" 묶음에 macOS 3종, Windows 4종(x64·ARM64 × System·User), Linux 6종이 모두 있다.
- **설치 안내**: 없다.
- **상호작용과 모션** [측정]
  - 설치를 돕는 상호작용: 버전별 펼침. "3.23 ↓"를 누르면 같은 OS별 목록과 "View release notes →"가 펼쳐진다. Terminal 카드의 명령 복사 버튼
  - 설명 모션: Desktop·Terminal 카드의 에이전트 작업 시연(1.5초 간격으로 계속 바뀜). 제품 기능을 보여 준다.
  - 장식 모션: 시트 등장(`sheet-slide-up`) 1개
  - reduce: CSS 애니메이션은 0개가 됐지만, 카드 시연은 계속 바뀌었다.
- **버전·변경 내역·이전 버전** [관측]
  - 최신 3.24는 펼친 채로, 3.23부터 3.18까지 6개는 접힌 채로 둔다. 버전마다 OS·칩별 파일과 릴리스 노트 링크가 있다.
  - 체크섬은 없다.
- **모바일** [관측]: 첫 화면이 제목과 시연 카드다. 쿠키 상자가 화면 아래 20% 정도를 덮는다. 데스크톱 Safari처럼 유니버설 파일 버튼이 나온다.
- **Stardraft에 주는 점**
  - 칩 감지 → 실패하면 안전한 기본값 → 아래 전체 목록, 이 3단 구조는 그대로 쓸 만하다. Stardraft는 유니버설이 없으므로 "실패하면 확인 방법 안내"로 바꾼다.
  - 이전 버전을 같은 페이지의 펼침으로 두는 방식은 09의 "사이트 안 이전 버전 목록"과 맞는다. SHA256 줄만 더하면 된다.
  - 제품 시연 카드는 "기능 홍보는 하지 않는다"는 09 결정과 맞지 않는다.

## 9. LM Studio

- URL: <https://lmstudio.ai/download> (조회 2026-10-16)
- 스크린숏: [데스크톱](download-site-ux/lmstudio-desktop.png), [모바일](download-site-ux/lmstudio-mobile.png), [OS 선택 상자 열림](download-site-ux/lmstudio-os-select-desktop.png)
- **첫 화면** [관측]
  - 흰 바탕 한 단이다. 위쪽은 다른 앱(Bionic) 다운로드, 가로줄 아래가 LM Studio 다운로드다.
  - "LM Studio for [macOS] running [M series] version [0.4.26 (build 4)]"처럼 선택 상자 3개를 문장으로 잇는다.
  - 그 밑에 "Download LM Studio for macOS 0.4.26" 버튼(버전이 버튼 오른쪽에 붙는다)과 "Release notes v0.4.26" 링크가 있다.
- **OS·칩 감지** [측정]
  - Mac 세 프로필 모두 `darwin/arm64`. Windows UA는 "Download LM Studio for Windows" → `win32/x64`
  - macOS를 고르면 칩 상자에는 "M series"만 있다. Intel Mac은 지원하지 않는다는 뜻을 선택지로 보여 준다 [추론].
  - 감지가 틀렸을 때: OS 상자를 열어 macOS·Windows·Linux 중 고른다.
  - `/download/latest/darwin/arm64`는 `installers.lmstudio.ai/darwin/arm64/0.4.26-4/LM-Studio-0.4.26-4-arm64.dmg`로 302 리디렉트한다. 사이트 경로는 버전 없이 고정이고, 실제 파일 이름에만 버전이 있다.
- **설치 안내**: 없다. 서버용 데몬 설치 명령(macOS·Linux와 Windows)만 있다.
- **상호작용과 모션** [측정]: 선택 상자 3개. 애니메이션 0개, 첫 화면 정지.
- **버전·변경 내역·이전 버전** [관측]
  - 버전 상자에는 현재 버전 하나뿐이다. 이전 버전은 이 페이지에서 받을 수 없다.
  - 베타는 `/beta-releases`, 변경 내역은 `/changelog`로 따로 있다.
- **모바일** [측정·관측]: LM Studio 버튼 글자가 "Copy Download Link macOS"로 바뀐다. 휴대폰에서 받지 않고, 링크를 복사해 PC로 넘기게 한다.
- **Stardraft에 주는 점**
  - 모바일 "다운로드 링크 복사"는 사내 메신저로 링크를 받아 휴대폰으로 여는 경우에 맞다.
  - 지원하지 않는 칩을 선택지에서 빼는 방식은 "Apple Silicon 전용"을 보여 주는 한 방법이다.

## 10. Zed

- URL: <https://zed.dev/download>, <https://zed.dev/releases/stable> (조회 2026-10-16)
- 스크린숏: [데스크톱](download-site-ux/zed-desktop.png), [모바일](download-site-ux/zed-mobile.png)
- **첫 화면** [관측]
  - 가는 격자 무늬 바탕. 왼쪽 큰 앱 아이콘, 가운데 버전 "1.23.3"(가장 큰 글자), 날짜 "October 12, 2026", "View changelog →"
  - 그 밑에 Stable·Preview 전환, macOS(칩 선택 "Apple Silicon ⌄", 버튼, "Requires version 10.15 or later"), Windows(칩 선택, 버튼), Linux(설치 명령과 복사 버튼)가 세로로 이어진다.
  - 오른쪽에 뉴스레터 구독 카드가 있다.
- **OS·칩 감지** [측정]
  - 모든 OS를 한꺼번에 보여 준다. 대표 버튼은 없다.
  - macOS 칩 기본값은 네 프로필 모두 Apple Silicon이다. Windows 칩 기본값은 arm 힌트면 ARM64, x86 힌트나 힌트 없음이면 Intel/AMD다.
  - 감지가 틀렸을 때: OS마다 칩 선택(macOS는 Apple Silicon·Intel Chip)으로 바꾼다.
- **설치 안내** [관측]: 없다. 버튼은 `/download-success?asset=…` 페이지로 간다. 이 페이지는 "Your download has started!"와 Discord·뉴스레터·문서 링크 3개뿐이다. 설치 단계는 없다.
- **상호작용과 모션** [측정]
  - 설치를 돕는 상호작용: Stable·Preview 전환, OS별 칩 선택, 명령 복사
  - Preview로 바꾸면 버전이 1.25.0으로 바뀌고 "Zed's Preview version is designed for those who like to live on the bleeding edge."라는 설명 한 줄이 생긴다 [관측].
  - 장식 모션: 아이콘 위에 투명도 15%로 덮은 142px canvas가 계속 바뀐다(노이즈 질감). 나머지는 정지
  - reduce: canvas가 그대로 바뀌었다.
- **버전·변경 내역·이전 버전** [관측]
  - 릴리스 페이지는 왼쪽에 버전 목록, 오른쪽에 버전마다 날짜, OS·칩별 다운로드, 변경 내용을 둔다.
  - 다운로드 페이지는 1.23.3(10월 12일)인데 릴리스 페이지 맨 위는 1.24.2(10월 14일)였다. 두 페이지의 버전 출처가 달라 보인다 [추론].
- **모바일** [관측]: 한 단으로 쌓인다. OS·칩 선택과 버튼이 모두 남는다. 10곳 중 모바일 배치가 가장 깔끔하다.
- **Stardraft에 주는 점**
  - 버전·날짜·변경 내역 링크를 다운로드 버튼 위에 두는 배치와, 버튼 밑 지원 환경 한 줄은 그대로 쓸 만하다.
  - 버전 정보는 한 곳(사이트 함수)에서만 읽어야 두 페이지가 어긋나지 않는다.

## 11. 패턴 정리

### 여러 사이트에 공통인 패턴

- **지원 환경 한 줄** (7곳)
  - 다운로드 버튼 바로 밑: Raycast "macOS Tahoe and Apple Silicon required", Rectangle "Supports macOS 10.15+, Intel and Apple Silicon", Maccy "Requires macOS Sonoma 14 or higher", Zed "Requires version 10.15 or later"
  - OS 절 맨 위: Stretchly "Requires macOS Monterey (12) or later.", Espanso "Windows 10 or later, currently only on x64", Flameshot "64-bit only"
- **OS 감지는 UA로, 대표 버튼 하나만 바꾼다** (Raycast, Espanso, Cursor, LM Studio)
  - 칩까지 가르는 곳은 Cursor 하나였다. Zed는 Windows 칩만 힌트를 따른다.
  - 감지가 틀렸을 때의 출구는 버튼 바로 밑 다른 OS 링크(Espanso), 아래쪽 전체 목록(Cursor), 선택 상자(LM Studio, Zed)였다.
- **패키지 관리자 명령과 복사 버튼** (Raycast 모달, Espanso, Zed, Flameshot, Stretchly, AeroSpace)
- **이전 버전은 대개 GitHub Releases로 보낸다** (Stretchly, Flameshot, Maccy, Espanso, AeroSpace)
  - 사이트 안에 둔 곳은 Cursor(펼침), Rectangle(`/versions`), Zed(릴리스 페이지) 세 곳이다.
- **설치 경고 안내는 다운로드 버튼 옆이 아니라 문서 하위 페이지에 글로 둔다** (Flameshot, Espanso, AeroSpace, Stretchly)
  - 대화상자 그림은 Espanso 1장뿐이다. **HTML로 대화상자를 재현한 곳은 없다.**
- **macOS 15에서 막힌 "우클릭 > 열기"를 아직 안내한다** (Stretchly, Flameshot, AeroSpace)
- **모션을 쓰는 곳은 모두 reduced-motion을 지키지 않았다** (Raycast, Maccy, Espanso, Cursor, Zed)
  - 설치를 설명하는 모션은 10곳 모두 없다. 모션은 제품 시연이거나 장식이었다.
- **업데이트·삭제 안내는 거의 없다.** Stretchly의 brew 명령이 전부다.
- **모바일 처리는 세 갈래다.** 다운로드 숨김(Raycast), 링크 복사(LM Studio), 그대로 둠(나머지)

### Stardraft에 가져올 만한 것

- **감지 → 대표 버튼 하나 → 바로 밑 다른 OS 링크 → 아래 전체 목록**
  - 이유: 대부분은 버튼 하나로 끝나고, 틀린 사람도 한 번에 고칠 수 있다 (Espanso, Cursor).
- **버튼 밑 지원 환경 한 줄**: "Apple Silicon Mac, macOS 13 이상", "Windows 10 이상, x64"
  - 이유: 4곳이 버튼 바로 밑을 쓴다. 누르기 직전에 보게 된다.
- **칩 판별을 하되, 판별 결과를 글로 보여 주고 고칠 길을 준다**
  - Chromium에서 `architecture`가 `arm`이면 그대로 진행한다. `x86`이면 Raycast V1 모달처럼 지원하지 않는 이유를 한 문장으로 알린다. Stardraft에는 대체 파일이 없으므로 "배포 담당자에게 알려 달라"로 끝낸다.
  - Safari·Firefox는 칩을 판별할 수 없다 ([호스팅 조사 11번](download-site-hosting.md#한눈에-보기)). 이때는 Pinokio처럼 추측을 글로 밝히고("칩을 확인하지 못했습니다"), Stretchly처럼 확인 방법(Apple 메뉴 > 이 Mac에 관하여)을 링크한다.
- **번호와 강조 상자를 붙인 실제 화면 스크린숏** (Espanso)
  - 이유: 10곳 중 경고 화면을 가장 빨리 알아보게 한다. 19에서 정한 "막히는 화면 4곳 실제 스크린숏"과 맞는다.
  - Espanso의 약점(옛 버전 화면, 모바일에서 글자가 너무 작음)은 피한다. 앱 버전이 바뀌어도 그림 속 이름이 `Stardraft`면 된다.
- **사람이 실수하는 지점을 단계로 적는다** (Flameshot)
  - "완료를 누르세요. 휴지통으로 옮기지 마세요", "아래로 스크롤하면 Stardraft가 차단됨이 보입니다", "메뉴바에 아이콘이 보이면 끝입니다"
- **화면에 뜨는 경고 문구를 그대로 인용해 "이 문구가 보이면"으로 시작한다** (AeroSpace, Flameshot)
  - 이유: 사용자는 경고 문구로 검색하고 찾는다.
- **서명하지 않은 이유를 한 문장으로 밝힌다** (Stretchly, AeroSpace)
  - 사내 도구 맥락으로 바꾼다. 예: "사내 소규모 도구라 Apple·Microsoft 인증서로 서명하지 않았습니다."
- **신뢰 문구** (Maccy): "이 주소에서 받은 파일만 설치하세요"와 SHA256 확인을 첫 화면 가까이에 둔다.
- **버전·날짜·변경 내역 링크를 다운로드 위에** (Zed), **이전 버전을 같은 페이지 펼침으로** (Cursor), 여기에 SHA256 복사를 더한다.
- **업데이트 전 앱 종료와 삭제 절차** (Stretchly): 10곳 중 유일하다. 09 요건 5·8번을 채운다.
- **모바일에서는 "PC에서 열 링크 복사"와 설치 안내 읽기를 남긴다** (LM Studio, Zed)
  - 이유: 링크를 사내 메신저로 받아 휴대폰에서 먼저 열 수 있다. Raycast처럼 다운로드를 통째로 숨기면 안내도 못 본다.
- **명령 복사 버튼** (Espanso, Zed): 최후 수단 `xattr` 명령에 쓴다. 복사하면 "복사됨" 글자만 바꾼다.

### 피할 것

- **장식 배경 모션**: Raycast 빛줄기 canvas, Espanso 입자 그물, Zed 노이즈 canvas
  - `ui-design` Hard No의 "random blur/glow, decorative blob"과 겹친다. 19 티켓도 장식용 모션을 피하라고 했다.
- **CTA를 등장 애니메이션 뒤에 숨기기**: Espanso는 3.5초 뒤에도 버튼이 반투명했다.
- **reduced-motion 무시**: 5곳 모두 그랬다. Stardraft는 `prefers-reduced-motion: reduce`에서 모든 전환을 즉시 바꿈으로 둔다.
- **어두운 고급 SaaS 화면과 떠 있는 헤더 띠**(Raycast): Hard No의 "generic dark SaaS composition", "glassmorphism shell"
- **회전하는 `conic-gradient` 테두리**(Raycast "The Raycast Keyboard" 버튼): Hard No의 "gradient border", "conic-gradient"
- **대문자·자간 넓은 라벨**: Rectangle "DOWNLOAD", Maccy "NO FLUFF", Raycast 고정폭 작은 라벨. Hard No의 "uppercase eyebrow label, letter-spaced muted label"
- **pill 버튼 남발**(Rectangle, Cursor): Hard No의 "pill overload". 버튼 radius는 8~10px로 둔다.
- **제품 시연 카드와 기능 소개 그리드**(Cursor, Maccy, Raycast): 09 결정 "기능 홍보는 하지 않는다"와 어긋난다.
- **쿠키 배너가 모바일 화면을 덮는 것**(Cursor): 추적 도구를 넣지 않으면 배너도 필요 없다 [추론].
- **macOS 15에서 막힌 "우클릭 > 열기" 안내**(Stretchly, Flameshot, AeroSpace): Apple 안내와 다르다. 사용자가 막힌다.
- **OS와 무관한 기본 탭**(Flameshot은 Mac에서도 Windows 탭)
- **두 페이지가 서로 다른 버전을 보여 주는 것**(Zed 1.23.3과 1.24.2)
- **비꼬는 말투**(AeroSpace "yes, it's that stupid")

### 미서명 설치 경고 안내를 가장 잘한 사례

- 한 곳이 다 잘한 경우는 없다. OS별로 가장 나은 곳을 고른다.
- **macOS: Flameshot**
  - 번호 단계 7개가 경고 → 완료 → 시스템 설정 → 그래도 열기 → 권한 → 완료 확인까지 이어진다.
  - "휴지통으로 옮기지 마세요"처럼 실수 지점을 막는다. 끝에 완료 상태(메뉴바 아이콘)를 알려 준다.
  - 아쉬운 점: 우클릭 열기 단계가 섞여 있다. 경고 대화상자 그림이 없다. 다운로드 버튼이 아니라 문서 하위에 있다.
- **Windows: Espanso**
  - SmartScreen 두 상태를 나란히 놓고 번호 화살표와 초록 상자로 누를 곳을 짚는다. 한 그림으로 2클릭이 끝난다.
  - 아쉬운 점: 옛 버전 화면이다. 모바일에서 그림 속 글자가 읽히지 않는다. 스마트 앱 컨트롤처럼 "실행" 버튼이 없는 경우를 다루지 않는다.
- **정직함과 수명 주기: Stretchly**
  - 서명하지 않은 이유, 그래도 열기 위치, 업데이트 전 종료, 삭제 명령까지 다룬다. 글뿐이라 따라 하기는 어렵다.
- 10곳 모두 다루지 않은 것. Stardraft가 새로 채워야 한다.
  - 스마트 앱 컨트롤 확인(첫 단계)
  - 새 버전 설치 때 다시 확인을 받는다는 안내(SmartScreen, Keychain 재허용, 알림 권한)
  - "그래도 열기" 버튼이 안 보일 때(1시간 경과 등)의 분기
  - 근거 문구는 [트레이 앱 조사의 안내문 초안](tray-app-framework.md#사용자-안내문-초안)과 [09 티켓](../issues/09-download-site.md)의 제약을 따른다.

### 프로토타입 구성 제안

세 안 모두 같은 내용 8가지를 담는다. 차이는 설치 안내를 어떻게 보여 주느냐, 상호작용과 모션을 어디까지 쓰느냐다.

#### 안 A. 한 페이지 문서형

- 흐름
  - 첫 화면: `Stardraft`와 한 줄 소개, 감지한 OS의 다운로드 버튼 하나, 버튼 밑 지원 환경 한 줄, "다른 OS용 받기" 링크
  - 같은 줄에 현재 버전·날짜·변경 내역 링크와 SHA256 복사
  - 신뢰 문구: 서명하지 않은 이유 한 문장, "이 주소에서 받은 파일만 설치"
  - 설치 전 필요한 것
  - OS 탭(감지 결과로 기본 선택, 직접 바꿀 수 있음): 번호 단계 목록. 단계마다 한 문장 지시, 실제 스크린숏(번호·강조 상자), 그 밑에 "여기서 막히면" 펼침
  - 업데이트 방법, 변경 내역, 이전 버전 표(버전·날짜·파일·SHA256), 삭제 방법
- 상호작용: 낮음. OS 탭, 펼침, 복사 버튼
- 모션: 없음. 탭과 펼침은 즉시 바뀐다
- 참고한 곳: Zed(버전 위치), Espanso(그림), Flameshot(단계), Cursor(이전 버전)
- 장점: 만들기와 고치기가 가장 쉽다. 검색과 인쇄가 된다. 모바일에서도 그대로 읽힌다.
- 약점: "인터랙티브" 요구 중 시각 연출 쪽이 거의 없다.

#### 안 B. 단계 진행형 체크리스트

- 흐름
  - 첫 화면은 안 A와 같다.
  - 다운로드 버튼을 누르면 파일 받기가 시작되고, 바로 아래 설치 가이드가 1단계부터 열린다.
  - 가이드는 한 번에 한 단계를 크게 보여 준다. 위에 "3 / 6" 진행 표시, 아래에 "됐어요"와 "안 돼요" 버튼
  - "안 돼요"를 누르면 그 단계의 막힘 분기로 간다.
    - macOS: "그래도 열기가 안 보여요" → 앱을 한 번 더 열어 보기 → 그래도 없으면 `xattr` 최후 수단(복사 버튼)
    - Windows: "실행 버튼이 없어요" → 스마트 앱 컨트롤 확인 → 켜져 있으면 배포 담당자에게 알리기
  - 모든 단계를 마치면 "메뉴바(트레이)에 아이콘이 보이면 끝" 확인 화면
  - 그 아래 업데이트, 변경 내역, 이전 버전, 삭제는 안 A와 같다. 가이드 전체를 펼쳐 보는 "모든 단계 한 번에 보기"도 둔다.
- 상호작용: 중간. 단계 이동, 막힘 분기, 진행 상태 기억(브라우저 저장, 없어도 동작)
- 모션: 설명용만
  - 단계가 바뀔 때 짧은 페이드(150~200ms)
  - 스크린숏의 누를 곳 강조 상자를 한 번 그려 보이기
  - reduce에서는 모두 즉시 바뀌고 강조 상자는 처음부터 보인다
- 참고한 곳: Flameshot(완료 기준), Espanso(번호 강조), Raycast(지원하지 않는 환경 모달)
- 장점: 막힌 사람을 분기로 이끈다. "설치를 돕는 상호작용"과 "설명하는 시각 연출"을 둘 다 채운다.
- 약점: 분기 문구와 상태가 늘어 관리할 것이 많다. 단계 하나만 보이므로 전체를 훑고 싶은 사람에게는 "한 번에 보기"가 꼭 필요하다.

#### 안 C. 대화상자 재현 연습형

- 흐름
  - 안 B와 같고, 막히는 단계에 **HTML로 재현한 대화상자**를 더한다.
    - macOS 경고창, 시스템 설정 "개인정보 보호 및 보안" 목록, Windows "Windows의 PC 보호" 2상태
  - 재현 화면에서 "추가 정보"를 누르면 "실행" 버튼이 나타나는 식으로 미리 눌러 볼 수 있다.
  - 재현 옆에 "실제 화면" 토글로 실제 스크린숏을 둔다(19에서 정한 4곳).
  - 재현 화면 위에는 항상 "예시 화면입니다" 표시를 붙인다.
- 상호작용: 높음. 재현 대화상자 클릭, 커서 경로 따라가기
- 모션: 설명용이 많다. 재현 창 열림·닫힘, 커서가 누를 곳으로 움직이는 짧은 연출. reduce에서는 단계별 정지 화면
- 참고한 곳: 10곳 중 없다. 새로 만드는 형태다.
- 장점: 시각 연출 요구를 가장 강하게 채운다. 처음 보는 사람도 미리 연습하고 간다.
- 약점과 위험
  - OS 버전마다 대화상자 모양과 문구가 바뀐다. 재현을 계속 맞춰야 한다.
  - 진짜 OS 창으로 착각할 수 있다. 피싱처럼 보일 위험이 있다.
  - 재현과 실제 화면이 다르면 오히려 헷갈린다.

#### 판단 근거 (19 티켓에서 사용자와 정할 것)

- 10곳 모두 설치를 설명하는 모션이 없고, 대화상자 재현도 없다. 안 B와 안 C는 사례가 아닌 새 시도다.
- 막히는 지점은 두 군데로 좁다(macOS 그래도 열기, Windows 추가 정보). 그래서 안 B로 분기를 주고, 안 C의 재현은 Windows 2클릭처럼 모양이 단순한 한 곳에만 시험하는 길도 있다 [추론].
- 어느 안이든 첫 화면은 같다. 대표 버튼 하나, 지원 환경 한 줄, 다른 OS 링크, 버전·SHA256이다. 첫 화면은 먼저 고정하고 설치 안내 부분만 안끼리 비교하면 된다.
