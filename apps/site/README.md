# 다운로드 사이트

`stardraft.squadify.app`의 한 페이지 다운로드 문서다. Astro로 정적 페이지를 내고, 예시 화면처럼 상호작용하는 부분만 React로 만든다. 아래 세 엔드포인트만 Vercel 함수로 돈다.

| 주소 | 하는 일 |
| :- | :- |
| `/download/mac`, `/download/windows` | 가장 최근 공개 Release의 DMG·exe로 302 |
| `/download/<버전>/<os>` | 그 버전 공개 Release의 파일로 302 |
| `/api/releases` | 최근 공개 Release 3개의 버전·날짜·파일 크기·sha256·릴리스 노트(CDN 5분 캐시) |

초안과 사전 릴리스는 고르지 않는다. 잘못 나간 버전을 사전 릴리스로 바꾸면 다운로드도 바로 이전 버전으로 돌아간다.

## 명령

```sh
pnpm --filter @stardraft/site dev        # .env의 값으로 로컬 실행
pnpm --filter @stardraft/site build      # VERCEL_GIT_REPO_OWNER가 있어야 한다
pnpm --filter @stardraft/site test
```

## Vercel 프로젝트 설정

- **Root Directory**: `apps/site`. 이 폴더의 `vercel.json`이 프레임워크(Astro)와 Ignored Build Step을 정한다.
- **Ignored Build Step**: 마지막으로 성공한 배포의 커밋(`VERCEL_GIT_PREVIOUS_SHA`, 없으면 직전 커밋)과 비교해 이 폴더와 루트의 의존성 파일(`package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.node-version`)이 바뀌지 않았으면 빌드하지 않는다. 앱 코드만 바뀐 푸시는 건너뛴다. 비교할 커밋을 찾지 못하면 git이 실패해 빌드한다.
- **환경 변수**
  - `VERCEL_GIT_REPO_OWNER`: Vercel이 Git 연결 프로젝트에 넣어 준다("Automatically expose System Environment Variables"가 켜져 있어야 함).
  - `GITHUB_RELEASE_TOKEN`: 공개 정보만 읽는 fine-grained 토큰(저장소 접근은 "Public repositories", 권한 없음). Vercel 서버는 IP를 나눠 써서 인증 없이 부르면 남이 한도를 소진할 수 있다.
- **도메인**: `stardraft.squadify.app`은 저장소 주인이 직접 연결한다.
