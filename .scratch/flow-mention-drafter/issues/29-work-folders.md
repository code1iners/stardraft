# 29: 작업 폴더

**Spec:** [스펙](../spec.md) 5절 "작업 폴더", "후보 찾기", 13절 "작업 폴더"

**What to build:** 설정 창 "저장소" 칸에서 "폴더 추가…"로 작업 폴더를 여러 개 고르면, 앱이 바로 훑어 "저장소 12개"처럼 보여 주고 펼치면 저장소 이름이 나온다. 홈 폴더 아래 흔한 이름의 폴더를 "이 PC에서 찾은 폴더"로 제안한다.

**Blocked by:** 24

**Status:** resolved

- [x] OS 폴더 선택 창으로 여러 개를 한 번에 고를 수 있고, 경로는 OS 고유 형식의 절대 경로로 `settings.json`에 저장된다.
- [x] 후보 찾기 규칙: 최대 3단계 깊이의 `.git` 디렉터리 또는 worktree의 `.git` 파일, 저장소 안으로는 내려가지 않음, 숨김 폴더와 `node_modules` 건너뜀, 고른 폴더 자체가 저장소면 그 하나. 0개면 경고하되 추가는 막지 않는다.
- [x] 네트워크 경로(`\\server\share`)와 WSL 경로(`\\wsl.localhost\...`)는 이유를 보여 주고 받지 않는다.
- [x] `~/workspace`, `~/projects`, `~/dev`, `~/code`, `~/src`, `~/IdeaProjects` 등 가운데 저장소가 든 폴더를 "이 PC에서 찾은 폴더"로 보이고 [추가]를 단다.
- [x] 후보 찾기는 임시 디렉터리에 가짜 저장소를 만들어 테스트된다.

## Comments

- 구현 위치
  - 후보 찾기와 받지 않는 경로 판정: `apps/desktop/src/core/repos/repo-candidates.ts`
  - 작업 폴더 목록, 추가·지우기, "이 PC에서 찾은 폴더": `apps/desktop/src/core/repos/work-folders.ts`
  - IPC 명령: `pick-work-folders`, `add-suggested-work-folder`, `remove-work-folder`, `refresh-work-folders`
  - 이벤트: `work-folders-changed`
  - 스냅숏 필드: `workFolders`
  - 화면: 설정 "저장소" 칸의 `RepositoriesSection.tsx`
- 후보 찾기 규칙
  - 고른 폴더 바로 아래를 1단계로 보고 3단계까지 찾는다.
  - `.git` 파일은 `gitdir:`로 시작할 때만 저장소로 센다(worktree, 서브모듈).
  - 폴더를 가리키는 심볼릭 링크는 그 자체가 저장소일 때만 센다. 순환을 막으려고 그 안으로는 내려가지 않는다.
  - 읽을 수 없는 하위 폴더는 건너뛴다. 작업 폴더 자체가 없으면 "폴더를 찾을 수 없음"으로 보인다.
- 받지 않는 경로
  - `\\`로 시작하는 Windows 경로만 판정한다.
  - `\\wsl.localhost\`, `\\wsl$\`는 WSL 경로다. 그 밖의 `\\server\share`와 `\\?\UNC\`는 네트워크 경로다.
  - `\\?\C:\`처럼 드라이브를 가리키는 긴 경로는 로컬로 받는다.
  - 네트워크 드라이브에 붙인 드라이브 문자(`Z:`)와 macOS `/Volumes`의 네트워크 공유는 경로만으로 구분할 수 없어 받는다.
- "이 PC에서 찾은 폴더"
  - 스펙의 "등"에 `repos`, `git`, `Developer`, `source/repos`(Visual Studio 기본), `Documents/GitHub`(GitHub Desktop 기본)를 더했다.
  - 앱 시작 때와 "저장소" 칸을 열 때 작업 폴더와 함께 다시 훑는다.
- 알려진 한계
  - 중복 판정은 경로 문자열 일치로 한다. macOS·Windows에서 대소문자만 다른 같은 폴더는 두 번 들어갈 수 있다.
  - 상위 폴더와 하위 폴더를 둘 다 작업 폴더로 두는 것도 막지 않는다.
- 검증
  - `pnpm typecheck`, `pnpm lint`, `pnpm test`(244개)가 통과했다.
  - `pnpm build`가 통과했다.
  - 후보 찾기와 작업 폴더는 임시 디렉터리에 가짜 저장소를 만들어 테스트했다.
- 실제 화면에서 확인하지 않은 것
  - 실제 OS 폴더 선택 창에서 여러 폴더를 한 번에 고르는 동작은 사용자 환경 항목이라 직접 조작하지 않았다. 실제 확인은 59에서 한다.
  - 코드로 확인한 범위: 창 설정의 `openDirectory`, `multiSelections`. 고른 경로들이 절대 경로로 `settings.json`에 저장되는 것은 core 테스트로 확인했다.
  - 칸의 실제 렌더링도 같은 이유로 59에서 확인한다.

