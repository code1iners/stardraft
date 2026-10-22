# 56: 다운로드 사이트: 페이지와 엔드포인트

**Spec:** [스펙](../spec.md) 16절(코드와 호스팅, 기술, 다운로드 함수, 공개 범위, 페이지 구성, 업데이트·변경 내역·이전 버전·삭제 섹션, 모션)

**What to build:** 사이트 패키지를 열면 한 페이지 문서가 뜬다. 왼쪽 목차, 감지한 OS의 대표 다운로드 버튼과 지원 환경·파일 크기·다른 OS 링크·버전·SHA256 복사, 오른쪽의 아이콘 자리 그림이 있다. `/download/mac`, `/download/windows`, `/download/<버전>/<os>`는 공개 Release의 파일로 302 하고, `/api/releases`는 버전·날짜·크기·sha256·릴리스 노트를 5분 캐시로 내준다. 설치 안내 단계의 자리는 비워 둔다(57).

**Blocked by:** 23

**Status:** resolved

- [x] Astro로 만들고 상호작용하는 부분만 React 19 + TypeScript. 세 엔드포인트는 Astro 서버 엔드포인트(Vercel 함수)이고 나머지는 정적. 어댑터 버전은 안정판으로 고정. Vercel 설정(Root Directory는 사이트 패키지, Ignored Build Step)이 저장소에 있다.
- [x] 다운로드 함수는 초안과 사전 릴리스를 고르지 않는다. `/api/releases`는 공개 정보만 읽는 토큰 하나를 쓰고 GitHub의 sha256 `digest`를 내보낸다.
- [x] OS 감지: `navigator.userAgentData`의 `architecture`와 UA. Apple Silicon·칩 불명·Intel Mac·Windows ARM·휴대폰·그 밖의 OS 여섯 경우의 첫 화면이 스펙대로이고, JS 전에는 두 버튼이 모두 보인다.
- [x] 섹션: 설치 전에 필요한 것(Flow 개인 API 키, Claude Code 설치와 로그인), 업데이트(스펙 16절 문구 그대로), 변경 내역(최근 3개 + GitHub 링크), 이전 버전과 SHA256(파일 표, OS별 확인 명령, GitHub Release 목록 링크, 다운그레이드 차단 안내), 삭제(OS별 단계, 데이터 폴더 경로 복사, 키체인 항목). 맨 아래에 서명하지 않은 이유 한 문장과 "이 주소에서 받은 파일만 설치하세요".
- [x] 회사 이름·사람 이름 없음, 한국어만, `noindex` 없음. `prefers-reduced-motion`에서 첫 화면 별 아이콘 반짝임이 멈춘다.
- [x] 가짜 GitHub `fetch`로 세 엔드포인트(초안·사전 릴리스 제외, 302 주소, 캐시 헤더, 출력 형식)가 테스트된다. 실제 Release 검증은 59.

## Comments

- 2026-10-22 구현 기록
  - 사이트 패키지는 Astro 7.4.1, `@astrojs/react` 7.1.0, `@astrojs/vercel` 11.0.16, React 19.3.1이다. 정확한 버전으로 고정했고, pnpm 최소 공개 기간 정책을 통과하는 안정판을 골랐다.
  - 세 엔드포인트(`prerender = false`)만 Vercel 함수(`nodejs24.x`)로 돌고, 페이지는 정적으로 낸다.
  - 환경 변수는 둘이다.
    - `VERCEL_GIT_REPO_OWNER`: GitHub 저장소 주인. Vercel이 넣어 주며, 없으면 빌드가 멈춘다.
    - `GITHUB_RELEASE_TOKEN`: 공개 정보만 읽는 토큰.
  - Root Directory·환경 변수·도메인 설정은 `apps/site/README.md`에 적었다. Ignored Build Step은 `apps/site/vercel.json`에 있다.
  - 응답의 캐시 머리글은 이렇게 정했다.
    - 다운로드 302는 `no-store`다. 사전 릴리스로 멈춘 버전이 바로 빠지게 하려는 것이다.
    - `/api/releases`는 `public, max-age=0, s-maxage=300`이다.
  - `/api/releases`는 최근 공개 Release 3개만 내준다. 파일은 사람이 받는 DMG와 exe만 담는다(`os`, `name`, `size`, `sha256`).
  - 릴리스 노트는 HTML로 풀지 않고 글 그대로 보인다.
  - 첫 화면의 버전·크기·SHA256과 변경 내역·파일 표는 브라우저에서 `/api/releases`로 받는다. Release를 공개할 때 사이트를 다시 배포하지 않아도 되게 하려는 것이다.
  - SHA256 복사는 받을 OS가 정해진 방문 환경에서만 보인다. 두 OS 버튼을 함께 보일 때는 어느 파일의 값인지 모호해서 넣지 않았다.
  - 설치 안내 섹션(`#install`)과 업데이트 섹션의 Keychain 예시 화면 자리는 57에서 채운다.
- 검증
  - 루트 `pnpm lint`, `pnpm typecheck`(사이트는 `astro check`), `pnpm test`(사이트 45, 데스크톱 1210)가 모두 통과했다.
  - `VERCEL_GIT_REPO_OWNER=example-owner astro build`가 통과했다.
  - 빌드한 정적 파일과 가짜 `/api/releases`를 로컬 서버로 띄워 Chrome에서 1280px·390px 화면을 확인했다.
  - 실제 Vercel 배포, 실제 GitHub Release와 토큰, 실제 OS·브라우저별 첫 화면(Safari·Firefox·Windows ARM·휴대폰)은 확인하지 못했다. 감지와 첫 화면은 단위 테스트로만 확인했다. 실제 확인은 58·59의 몫이다.

