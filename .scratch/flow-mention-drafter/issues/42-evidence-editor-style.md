# 42: 근거 상호작용, 에디터에서 열기, 문체 검사

**Spec:** [스펙](../spec.md) 8절 "상세의 영역"의 근거, "행동과 버튼"의 에디터에서 열기, 6절 "초안 문체와 지침"의 문체 검사

**What to build:** 초안의 근거 번호를 누르면 근거 영역이 펼쳐지며 해당 근거가 강조된다. 근거의 위치 옆 "에디터에서 열기"를 처음 누르면 설치된 에디터 목록에서 고르고, 그 뒤로는 바로 그 줄이 열린다. 개발자 용어가 섞인 문장 옆에 "개발자 용어가 있을 수 있음"이 작게 보인다.

**Blocked by:** 40

**Status:** resolved

- [x] 근거마다 자연어 설명, 작은 글씨의 "저장소 · 파일 · N번째 줄", "에디터에서 열기". 근거 없는 문장은 "근거 없음". 번호 클릭 시 펼침과 강조.
- [x] 에디터 찾기(VS Code, Cursor, JetBrains IDE, Zed, Sublime Text)와 줄 단위 열기 방법(URL 스킴 또는 CLI)을 앱에 둔다. 처음 누를 때 고르게 하고 기억한다. 없으면 OS 기본 앱으로 파일만 연다. 설정 "일반"의 "직접 지정"은 `{file}`·`{line}` 자리가 있는 명령 한 줄이다.
- [x] 문체 검사 대상: 백틱, 파일 확장자처럼 생긴 말, 경로 구분자, 점 표기 키, camelCase, snake_case, 대문자 상수. 멘션 원문과 스레드에 나온 단어는 뺀다. 초안 문장과 근거 설명 모두 검사하고 자동 재생성은 없다.
- [x] 문체 검사 규칙과 예외가 테스트된다.

## Comments

### 2026-10-22 구현과 검증 기록

**구조**

- 문체 검사 `developerTerms(text, source)`, `sourceWords(texts)`, `bundleSourceWords(bundle)` (`core/drafts/style-check.ts`)
  - 백틱, 파일 확장자처럼 생긴 말(이름.영문 다섯 글자 이하), 경로 구분자(`/`, `\`, 숫자만 나눈 날짜는 뺌), 점 표기 키, camelCase, snake_case, 대문자 상수(밑줄 필요, API 같은 약어는 뺌)를 짚는다.
  - 뺄 단어는 묶인 멘션 전부, 게시물 제목, 맥락의 본문·댓글·대댓글에 나온 말이다. 멘션 표기의 사용자 ID는 넣지 않는다.
  - 스냅숏의 `DraftSentenceSnapshot.developerTerms`, `EvidenceSnapshot.developerTerms`로 넘기고, 화면은 걸린 문장과 근거 설명 옆에 "개발자 용어가 있을 수 있음"을 작게 보인다(걸린 말은 마우스를 올리면 보임). 자동 재생성은 없다.
- 에디터 열기 `EditorOpener` (`core/editors/editor-opener.ts`), OS 기능 포트 `EditorSystem`(main 구현 `main/editor-system.ts`)
  - macOS는 `/Applications`, `~/Applications`, Windows는 `%LOCALAPPDATA%\Programs`, `%ProgramFiles%`, `%ProgramFiles%\JetBrains`에서 VS Code, Cursor, JetBrains IDE(IDE마다 따로), Zed, Sublime Text를 찾는다.
  - 줄 단위 열기: VS Code·Cursor는 `스킴://file/경로:줄` URL, JetBrains IDE는 실행 파일 `--line 줄 파일`, Zed·Sublime Text는 앱에 든 CLI에 `파일:줄`.
  - 기억한 에디터는 `Settings.editor`(`EditorChoice`)에 둔다. 아직 고르지 않았거나 기억한 에디터가 사라졌으면 고르기 창(`EditorSnapshot.picker`)을 띄우고, 찾은 에디터가 없거나 실행에 실패하면 OS 기본 앱으로 파일만 연다.
  - 직접 지정은 `{file}`·`{line}` 자리가 모두 있는 명령 한 줄이다. 셸 없이 조각으로 나눠 실행하므로 파일 경로가 명령으로 읽히지 않는다. 읽을 수 없는 명령은 저장하지 않는다.
  - 근거 파일 경로는 main이 근거 위치(`evidenceFileOf`)로 정한다. 위치를 찾지 못한 근거나 저장소 밖 경로는 열지 않는다. 렌더러는 묶음 ID와 근거 위치만 보낸다.
- IPC: 명령 `open-evidence-in-editor`, `choose-editor`, `close-editor-picker`, `set-editor`, 이벤트 `editor-changed`, 스냅숏 `AppSnapshot.editor`.
- 화면: 초안의 근거 번호는 버튼이다. 누르면 근거 영역을 펼치고 그 근거를 강조해 그 자리까지 내린다. 근거마다 "에디터에서 열기"가 있고 위치를 찾을 수 없으면 꺼진다. 설정 "일반"에 에디터 칸(처음 열 때 고르기 / 찾은 에디터 / 직접 지정)을 두었다.

**검증**

- `pnpm lint`, `pnpm typecheck`, 전체 `vitest run` 통과, `electron-vite build` 성공.
- 테스트: 문체 검사 규칙과 예외(`style-check.test.ts`), 묶음 스냅숏의 문체 표시(`review-snapshot.test.ts`), 가짜 OS로 에디터 찾기·고르기·기억·기본 앱 대체·직접 지정 명령·근거 파일 경로(`editor-opener.test.ts`), 명령 검사(`ipc.test.ts`), 근거 번호 버튼·에디터에서 열기·문체 표시·고르기 창(`review-screens.test.tsx`), 설정 에디터 칸(`general-section.test.tsx`).

**사용자 환경에서 확인할 것**(코드와 가짜 OS로만 확인함)

- 실제 macOS·Windows에서 각 에디터가 설치 위치에서 찾아지고 그 줄로 열리는지. 특히 Windows의 Zed·Sublime Text 설치 경로와 JetBrains Toolbox 설치 폴더 이름은 실기 미확인이다.
- 실제 창에서 근거 번호를 눌렀을 때 펼침·강조·스크롤, 에디터 고르기 창의 동작.

**결정과 남긴 것**

- 편집한 초안(편집본)은 문체 검사하지 않는다. 편집하면 근거 번호와 함께 문장 단위 표시가 사라진다. 편집본도 검사하려면 스펙에서 정해야 한다.
- 에디터 고르기 창 상태는 앱에 하나라서, 작은 창과 펼친 창이 함께 열려 있으면 두 창 모두에 뜬다. 어느 쪽에서 골라도 같다.
- 직접 지정 명령은 셸 없이 실행하므로 PATH에 의존하지 않게 전체 경로로 적도록 안내한다.
- `e.g.` 같은 영문 약어도 점 표기로 짚는다. 스펙 예(`a.b.c`)와 구분할 수 없어 그대로 두었다.
