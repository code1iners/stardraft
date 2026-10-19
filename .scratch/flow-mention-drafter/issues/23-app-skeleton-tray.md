# 23: 저장소 뼈대와 빈 트레이 앱

**Spec:** [스펙](../spec.md) 2절, 15절

**What to build:** 새 앱 저장소 `stardraft`의 뼈대를 세우고, 켜면 메뉴 막대(트레이)에 아이콘이 생기는 빈 앱을 만든다. 아이콘을 누르면 트레이 옆에 빈 작은 창이 뜨고, 오른쪽 클릭 메뉴에 창 열기, 설정…, 종료가 있다. 설정…을 누르면 왼쪽에 칸 목록(Flow 계정, 에이전트, 저장소, 초안, 일반)이 있는 빈 설정 창이 뜬다. 소스에서 실행하면 이름이 `Stardraft Dev`로 보인다. 이 저장소는 아직 GitHub에 올리지 않고 로컬 git으로만 둔다(GitHub 생성은 59 마법사).

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] 로컬 git 저장소로 시작하고 MIT 라이선스, `.gitignore`(`node_modules`, 빌드 산출물, `.env*`, 예외 `.env.example`)가 있다. 회사 데이터와 비밀값은 없다.
- [ ] pnpm 워크스페이스 + turbo, `packageManager` 고정, Node 24 LTS. 데스크톱 앱 패키지와 사이트 패키지 자리가 있다.
- [ ] Electron 최신 44.x, electron-vite + Vite(안정판 정확히 고정), React 19 + TypeScript. 앱은 core, main, preload, renderer 네 부분으로 나뉜다.
- [ ] core는 Electron을 import하지 않고, ESLint `no-restricted-imports`로 막혀 있으며, 포트(Flow API, 실행기, 상태 저장소, 설정 저장소, 비밀 저장소, 알림, 시계)의 인터페이스와 가짜 구현 골격이 있다. Vitest가 Node에서 돈다.
- [ ] 트레이 아이콘, 클릭 시 트레이 근처의 작은 창, 오른쪽 클릭 메뉴(창 열기, 설정…, 종료)가 동작한다. macOS는 `LSUIElement`로 Dock 아이콘을 숨기고, 설정 창이 열려 있는 동안만 Dock 아이콘(Windows는 작업 표시줄 단추)을 보인다. 창은 닫을 때 없앤다.
- [ ] 렌더러는 `contextIsolation`·`sandbox` 켜짐, `nodeIntegration` 꺼짐, 엄격한 CSP, 원격 콘텐츠 없음이며, preload의 타입 있는 IPC(상태 스냅숏·변경 이벤트·명령)로만 main과 통신한다.
- [ ] Fuses 설정(`RunAsNode`·`EnableNodeOptionsEnvironmentVariable`·`EnableNodeCliInspectArguments` 끔, `EnableEmbeddedAsarIntegrityValidation`·`OnlyLoadAppFromAsar` 켬)이 빌드 설정에 있다.
- [ ] 앱 이름 `Stardraft`, 식별자 `app.squadify.stardraft`. 소스 실행 시 `Stardraft Dev`로 이름이 바뀐다.
- [ ] PR과 main 푸시에서 lint, typecheck, 테스트를 ubuntu와 windows 러너에서 돌리는 워크플로 파일이 있다(실행 확인은 59 마법사).
- [ ] 스펙, `GLOSSARY.md`, ADR 0001·0002를 회사 정보가 없는지 확인한 뒤 새 저장소의 문서 자리로 옮겼다.
