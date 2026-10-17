# 다운로드 사이트 호스팅과 배포 경로 조사

- 조사일: 2026-10-16
- 티켓: [다운로드 사이트 형태 결정](../issues/09-download-site.md)
- 전제
  - 앱 이름은 `Stardraft`다. macOS arm64 DMG(ad-hoc 서명), Windows x64 NSIS 원클릭 설치 파일(미서명)을 낸다.
  - 소스는 개인 계정(GitHub Free)의 비공개 저장소 `stardraft`에 있다.
  - `v*` 태그를 푸시하면 Actions가 macOS·Windows 러너에서 빌드하고, 마지막 job 하나가 DMG, exe, `SHA256SUMS.txt`를 담은 초안 Release를 만든다. 공개는 사용자가 직접 누른다. 빌드 도구는 electron-builder 26.17.0이다. 근거는 [Electron 빌드 스택 조사](electron-build-stack.md)에 있다.
  - 사이트를 볼 사람은 사내 팀원 10명 안팎이다. GitHub 계정 보유 여부는 모른다.
- 조사 방법
  - 공식 문서, 공식 저장소 소스, 공식 요금 페이지만 근거로 삼았다.
  - 몇 가지는 비인증 `curl`로 공개 저장소와 공개 사이트에 요청해 확인했다. 사용자 계정에 저장소나 Release를 만드는 실험은 하지 않았다.
  - 표기
    - [문서]: 공식 문서 원문
    - [소스]: 공식 저장소 코드
    - [실측]: 직접 요청해 본 결과(2026-10-16)
    - [이슈]: GitHub 이슈와 PR
    - [추론]: 위 출처에서 끌어낸 판단. 실행해 보지 않았다.
    - [추측]: 공식 근거가 없고 커뮤니티 보고에만 기대는 것
  - 날짜 표기
    - GitHub Docs 페이지에는 날짜가 없다. 그래서 [github/docs](https://github.com/github/docs) 저장소에서 해당 원본 파일의 마지막 커밋일을 "원본 커밋"으로 적는다. 공용 조각(reusables)만 바뀐 경우는 이 날짜에 반영되지 않는다.
    - Cloudflare는 페이지의 "Last updated", Vercel은 `last_updated`, Microsoft Learn은 `ms.date`를 적는다.

## 한눈에 보기

| # | 질문 | 답 |
|---|---|---|
| 1 | Free 비공개 저장소로 Pages | **안 된다.** Free는 공개 저장소에서만 Pages를 쓸 수 있다 |
| 1 | Pro 비공개 저장소로 Pages | 된다. 하지만 **사이트는 인터넷에 공개**된다 |
| 1 | 비공개 Pages(접근 제어) | **조직 계정 + GitHub Enterprise Cloud**에서만 된다. 개인 계정은 어떤 요금제로도 안 된다 |
| 2 | 비로그인 사용자가 비공개 저장소 Release 파일 받기 | GitHub 기능으로는 **방법이 없다.** 토큰을 가진 중계 서버가 있어야 한다 |
| 2 | 공개 저장소의 초안 Release | push 권한이 있는 사람에게만 보인다 |
| 2 | `releases/latest`, `.../latest/download/<파일명>` | 초안과 사전 릴리스는 **건너뛴다.** 파일명이 버전마다 같아야 다운로드 링크가 유지된다 |
| 3 | 다른 공개 저장소에 Release 만들기 | `GITHUB_TOKEN`으로는 **안 된다.** fine-grained PAT(`Contents: Read and write`) 또는 GitHub App 토큰이 필요하다 |
| 3 | PAT 최대 유효기간 | 개인 계정은 **만료 없음**도 고를 수 있다. 직접 날짜를 줄 때는 최대 366일이다. 1년 동안 안 쓰면 자동 삭제된다 |
| 3 | 공개 저장소 태그가 가리키는 커밋 | 그 공개 저장소의 커밋이다. 기본값은 공개 저장소 기본 브랜치의 최신 커밋이다. **앱 소스 커밋과 무관하다** |
| 4 | 웹에서 초안을 Publish 하면 `release: published` 워크플로가 도는가 | **돈다.** 이벤트를 만든 주체가 사용자이기 때문이다 |
| 4 | `GITHUB_TOKEN` 규칙 | 자동화가 **같은 저장소의 `GITHUB_TOKEN`으로** 공개하면 돌지 않는다. PAT·App 토큰으로 공개하면 돈다 |
| 5 | Release 파일 크기, 대역폭 | 파일당 2 GiB 미만, 릴리스당 1000개. 총용량과 대역폭 제한은 없다 |
| 5 | Pages 제한 | 사이트 1 GB, 대역폭 월 100 GB(soft), 배포 10분. 사내 도구 다운로드 안내 페이지를 막는 조항은 없다 |
| 6 | 사용자 지정 도메인을 나중에 붙이면 | 문서에 명시는 없다. 실측으로는 `github.io/<repo>/…`가 새 도메인으로 **301 리디렉트되고 경로·쿼리가 유지**됐다 |
| 7 | REST API 비인증 한도와 CORS | IP당 시간당 60회. 모든 origin에 CORS를 허용한다(`Access-Control-Allow-Origin: *`) |
| 8 | Cloudflare Pages, Vercel에 DMG 넣기 | Cloudflare Pages는 파일당 25 MiB라 **불가**. Vercel은 개별 파일 상한을 문서에서 못 찾았고, Hobby는 상업적 이용 금지다 |
| 8 | Cloudflare Access 무료 | Zero Trust Free는 **50명**까지 0달러다. 이메일 일회용 PIN 로그인을 지원한다 |
| 9 | NSIS 원클릭 설치 파일을 앱 실행 중에 실행 | **"실행 중입니다. OK를 누르면 종료됩니다" 확인창**을 띄운다. OK면 강제 종료 후 설치, 취소면 설치를 멈춘다. `%APPDATA%\Stardraft`는 **유지**된다 |
| 9 | macOS에서 실행 중인 앱 덮어쓰기 | **근거 없음** |
| 10 | Electron 44 최소 OS | macOS 13 Ventura, Windows 10 |
| 11 | 브라우저에서 Mac 칩 판별 | Chromium 계열만 된다. **Safari와 Firefox는 판별할 수 없다** |
| 12 | 스마트 앱 컨트롤 확인 경로 | Windows 보안 > 앱 & 브라우저 컨트롤 > 스마트 앱 컨트롤 설정. 상태는 평가 모드·켜기·끄기. Windows 10에는 없다 |

## 1. GitHub Pages와 비공개 저장소

- **Free**: 공개 저장소에서만 쓸 수 있다 [문서]
  - 원문: "If the account that owns the repository uses GitHub Free or GitHub Free for organizations, the repository must be public." [Creating a GitHub Pages site](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site) (원본 커밋 2026-08-21)
  - 요금제 표의 Free 항목도 "GitHub Pages in public repositories"다. [GitHub's plans](https://docs.github.com/en/get-started/learning-about-github/githubs-plans) (원본 커밋 2026-09-15)
- **Pro**: 비공개 저장소에서도 쓸 수 있다 [문서]
  - 같은 요금제 표에서 Pro의 "Advanced tools and insights in private repositories" 아래에 GitHub Pages가 있다.
  - Pro에서 Free로 내리면 비공개 저장소에서 게시한 사이트는 게시가 취소된다. 원문: "If you downgrade from GitHub Pro to GitHub Free, any GitHub Pages sites that are currently published from private repositories in your account will be unpublished." [About custom domains and GitHub Pages](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/about-custom-domains-and-github-pages) (원본 커밋 2026-07-09)
- **비공개 저장소에서 띄워도 사이트는 공개다** [문서]
  - 원문: "GitHub Pages sites are publicly available on the internet, even if the repository for the site is private (if your plan or organization allows it)." [Configuring a publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site) (원본 커밋 2026-07-09)
- **비공개 Pages(접근 제어)는 Enterprise Cloud 조직 전용이다** [문서]
  - 원문: "To publish a GitHub Pages site privately, you need to have an organization account. Additionally, your organization must use GitHub Enterprise Cloud." (위 요금제 표의 Pro 항목 주석)
  - 비공개로 게시한 사이트는 "can only be accessed by people with read access to the repository the site is published from." 즉 열람자마다 GitHub 계정과 저장소 읽기 권한이 필요하다. [Changing the visibility of your GitHub Pages site](https://docs.github.com/en/enterprise-cloud@latest/pages/getting-started-with-github-pages/changing-the-visibility-of-your-github-pages-site)
  - 조직 사이트(`<org>.github.io`)에는 접근 제어를 걸 수 없고, 프로젝트 사이트만 된다(같은 문서).
- 결론 [추론]
  - 지금 구성(개인 Free, 비공개 `stardraft`)에서는 `stardraft` 저장소로 Pages를 띄울 수 없다.
  - Pro로 올리면 띄울 수 있지만 사이트 내용은 누구나 본다.
  - GitHub만으로 사내 한정 사이트를 만드는 길은 없다. 열람자 전원의 GitHub 계정이 필요한 Enterprise Cloud 조직뿐이다.

## 2. 비공개 저장소의 Release 파일과 latest 링크

### 비로그인 사용자가 비공개 저장소 Release 파일을 받을 수 있는가

- **GitHub 기능으로는 없다.**
  - 원문: "Private repositories are only accessible to you, people you explicitly share access with, and, for organization repositories, certain organization members." [About repositories](https://docs.github.com/en/repositories/creating-and-managing-repositories/about-repositories#about-repository-visibility) [문서]
  - Release 문서도 "Anyone with read access to a repository can view and compare releases"라고만 적는다. 공개 공유 링크 같은 기능은 문서에 없다. [About releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases) (원본 커밋 2026-07-08) [문서]
- **우회로: 토큰을 가진 중계 서버**
  - "Get a release asset" API에 `Accept: application/octet-stream`을 주면 "The API will either redirect the client to the location, or stream it directly if possible. API clients should handle both a 200 or 302 response." [Release assets](https://docs.github.com/en/rest/releases/assets#get-a-release-asset) [문서]
  - 공개 자산으로 확인한 리디렉트 대상은 `release-assets.githubusercontent.com`의 서명된 URL이다. URL 안 JWT의 `nbf`와 `exp` 차이가 300초였다 [실측].
  - 추론: 서버(예: 서버리스 함수)가 토큰으로 이 API를 부르고, 받은 서명 URL로 사용자를 보내면 비로그인 다운로드가 된다. 서버를 운영하고 토큰을 보관해야 한다. 비공개 자산에서 같은 서명 URL이 나오는지는 실행해 보지 않았다.
- 그 밖의 길 [추론]
  - 파일을 공개 저장소의 Release로 옮긴다(3절).
  - `stardraft` 저장소를 공개로 바꾼다.
  - 다른 호스팅에 올린다(8절).

### 초안 Release는 공개 저장소에서 누구에게 보이는가

- push 권한이 있는 사람에게만 보인다.
  - 원문: "Information about published releases are available to everyone. Only users with push access will receive listings for draft releases." [Releases](https://docs.github.com/en/rest/releases/releases) [문서]
  - 웹 UI도 같은 기준이라고 본다 [추론]. "only people with write permissions to a repository can manage releases"([About releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases))와 맞는다.

### `releases/latest`와 `releases/latest/download/<파일명>`

- 문서상 동작
  - 웹 링크: "adding `releases/latest` to the end of a repository's URL". 다운로드 링크: "`/releases/latest/download/asset-name.zip`" [Linking to releases](https://docs.github.com/en/repositories/releasing-projects-on-github/linking-to-releases) (원본 커밋 2026-03-12) [문서]
  - 이 문서는 초안과 사전 릴리스를 어떻게 다루는지 적지 않는다.
  - REST "Get the latest release" 원문: "The latest release is the most recent non-prerelease, non-draft release, sorted by the created_at attribute. The created_at attribute is the date of the commit used for the release, and not the date when the release was drafted or published." [문서]
  - `make_latest` 원문: "Drafts and prereleases cannot be set as latest. Defaults to true for newly published releases." [문서]
  - 웹 UI 원문: "If you do not select this option, the latest release label will automatically be assigned based on semantic versioning." [Managing releases](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository) [문서]
- [실측] `electron/electron`
  - `releases/latest` → 302 `releases/tag/v44.8.0`
  - `releases/latest/download/SHASUMS256.txt` → 302 `releases/download/v44.8.0/SHASUMS256.txt`
  - 더 늦게 게시된 사전 릴리스 `v45.0.0-beta.5`(05:26)는 건너뛰었다.
  - `v43.8.0`은 `v44.8.0`보다 4시간 늦게 게시됐지만 latest가 아니었다. 추론: "가장 최근에 게시한 것"이 아니라 latest 라벨(semver 또는 명시 지정)을 따른다.
- 결론
  - 초안과 사전 릴리스는 latest가 될 수 없다. 그래서 latest 링크는 마지막으로 공개한 정식 릴리스를 가리킨다 [문서·실측].
  - 초안만 있고 공개 릴리스가 없으면 latest 링크는 갈 곳이 없다 [추론].
- **파일명 주의** [소스]
  - `latest/download/<파일명>`은 버전마다 같은 파일명이 있어야 깨지지 않는다 [추론].
  - electron-builder 기본 파일명은 버전을 포함한다.
    - DMG: `${productName}-${version}-${arch}.${ext}` (dmg-builder 26.17.0 `out/dmg.js`)
    - NSIS: `${productName} Setup ${version}.${ext}` (`nsisOptions.d.ts`의 `artifactName` 기본값)
  - GitHub는 특수문자가 든 파일명을 바꿔서 저장한다. 원문: "GitHub renames asset filenames that have special characters, non-alphanumeric characters, and leading or trailing periods." [Release assets](https://docs.github.com/en/rest/releases/assets#upload-a-release-asset) [문서]
  - 그래서 고정 링크를 쓰려면 `artifactName`을 버전 없는 이름(공백 없이)으로 바꿔야 한다. 아니면 사이트가 API나 빌드 시점 데이터에서 파일 URL을 받아야 한다 [추론].

## 3. 비공개 `stardraft`의 Actions에서 다른 공개 저장소에 Release 만들기

### `GITHUB_TOKEN`으로는 안 된다

- 원문: "The token's permissions are limited to the repository that contains your workflow." [GITHUB_TOKEN](https://docs.github.com/en/actions/concepts/security/github_token) (원본 커밋 2026-07-16) [문서]
- 원문: "the `GITHUB_TOKEN` can only access resources within the workflow's repository. If you need to access additional resources, such as resources in an organization or in another repository, you can use a GitHub App." [Making authenticated API requests with a GitHub App in a GitHub Actions workflow](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/making-authenticated-api-requests-with-a-github-app-in-a-github-actions-workflow) (원본 커밋 2026-07-13) [문서]

### fine-grained PAT

- **권한** [문서: [Permissions required for fine-grained PATs](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens)]
  - `POST /repos/{owner}/{repo}/releases`(생성)와 `PATCH .../releases/{release_id}`(수정·공개)는 "Repository permissions for Contents"의 `write`가 필요하다.
  - 자산 업로드(`uploads.github.com`)는 이 표에 없다. 같은 Contents 쓰기 권한으로 된다고 본다 [추론].
  - 대상 커밋이 기본 브랜치와 비교해 `.github/workflows/` 파일을 바꾸면 "Workflows" 쓰기 권한도 필요하다. 기본 브랜치 최신 커밋을 대상으로 하면 해당하지 않는다 [문서: [Create a release](https://docs.github.com/en/rest/releases/releases#create-a-release) 주석, 추론].
- **범위** [문서: [Managing your personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens) (원본 커밋 2026-07-30)]
  - "Each token is limited to access resources owned by a single user or organization." 같은 개인 계정 소유인 `stardraft-releases`만 고르면 된다.
  - "Only select repositories"로 저장소를 하나만 지정할 수 있다.
  - "Tokens always include read-only access to all public repositories on GitHub."
- **유효기간** [문서: 같은 문서]
  - 원문: "Infinite lifetimes are allowed but may be blocked by a maximum lifetime policy set by your organization or enterprise owner." 개인 계정 소유 저장소라 이 정책이 없으므로 만료 없음도 고를 수 있다 [추론].
  - 생성 URL 파라미터 `expires_in`: "Integer between 1 and 366, or `none`". 지정하지 않으면 30일이다.
  - 원문: "GitHub automatically removes personal access tokens that haven't been used in a year." 릴리스를 1년 넘게 안 하면 토큰이 사라진다.
- 주의 [추론]: PAT는 사람 계정에 묶인다. 만료를 두면 갱신 일정을 따로 관리해야 한다.

### GitHub App 대안

- 순서 [문서: 위 GitHub App 문서]
  - GitHub App을 등록한다. 권한은 Contents 쓰기로 둔다 [추론].
  - 개인 계정에 설치하고 `stardraft-releases`만 고른다.
  - `stardraft` 저장소에 client ID(변수)와 private key(비밀값)를 저장한다.
  - 워크플로에서 `actions/create-github-app-token@v3`로 설치 토큰을 만든다.
- 다른 저장소 지정 [소스: [create-github-app-token README](https://github.com/actions/create-github-app-token), 최신 v3.3.0 2026-10-12]
  - `owner`와 `repositories` 입력을 쓴다. 원문: "If `owner` and `repositories` are empty, access will be scoped to only the current repository."
  - 원문: "An installation access token expires after 1 hour." 빌드 마지막 job에서 만들어 바로 쓰면 충분하다 [추론].
- PAT와 비교 [추론]
  - App은 만료 관리가 없고, 사람 계정과 분리된다.
  - 대신 App 등록, 설치, 키 보관이라는 설정 단계가 더 있다.

### 업로드 도구

- `gh release create <tag> --repo OWNER/stardraft-releases --draft --target <브랜치> 파일…` [문서: [gh release create](https://cli.github.com/manual/gh_release_create)]
  - 원문: "If a matching git tag does not yet exist, one will automatically get created from the latest state of the default branch. Use `--target` to point to a different branch or commit for the automatic tag creation."
- electron-builder로 바로 올린다면 GitHub publish 설정에 `owner`, `repo`가 있다 [소스: builder-util-runtime 9.7.0 `publishOptions.d.ts`의 `GithubOptions`]. 지금 구조처럼 마지막 job에서 한 번에 올린다면 `gh`가 단순하다 [추론].

### 공개 저장소의 태그는 어떤 커밋을 가리키는가

- `target_commitish` 원문: "Specifies the commitish value that determines where the Git tag is created from. Can be any branch or commit SHA. Unused if the Git tag already exists. Default: the repository's default branch." [Create a release](https://docs.github.com/en/rest/releases/releases#create-a-release) [문서]
- 따라서 태그는 `stardraft-releases` 안의 커밋을 가리킨다. 기본값은 그 저장소 기본 브랜치의 최신 커밋이다 [문서].
- `stardraft`의 소스 커밋은 공개 저장소에 없으므로 가리킬 수 없다 [추론].
- Release에는 "Source code (zip/tar.gz)" 링크가 자동으로 붙는다. 원문: "GitHub will automatically include links to download a zip file and a tarball containing the contents of the repository at the point of the tag's creation." [About releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases) [문서]
  - 그래서 이 압축 파일에는 앱 소스가 아니라 `stardraft-releases` 저장소 내용(사이트 코드 등)이 들어간다 [추론]. 사이트에서 이 링크를 "소스 코드"로 안내하면 안 된다.
- 태그 생성 시점
  - 초안 단계에서는 태그를 만들지 않고 공개할 때 만든다는 보고가 있다 [추측: 공식 문서에 없음, 커뮤니티 보고와 웹 UI 문구].
  - 어느 쪽이든 태그는 위 `target_commitish` 기준으로 정해진다.
- 빈 저장소에는 태그를 만들 커밋이 없다. 공개 저장소에 커밋이 최소 하나 있어야 한다 [추론].
- 참고: 공개 저장소에 불변 릴리스(immutable releases)를 켜면 공개 뒤에는 자산을 바꾸거나 지울 수 없고, 태그도 옮길 수 없다. 문서는 초안을 만들고 자산을 모두 붙인 뒤 공개하라고 권한다. [Immutable releases](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases) [문서]

## 4. 웹에서 초안을 Publish 할 때 워크플로 트리거

- **`release` 이벤트** [문서: [Events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#release) (원본 커밋 2026-09-21)]
  - 활동 유형: `published`, `unpublished`, `created`, `edited`, `deleted`, `prereleased`, `released`
  - 원문: "Workflows are not triggered for the `created`, `edited`, or `deleted` activity types for draft releases."
  - 원문: "The `prereleased` type will not trigger for pre-releases published from draft releases, but the `published` type will trigger."
  - `GITHUB_SHA`는 "Last commit in the tagged release", `GITHUB_REF`는 `refs/tags/<tag_name>`이다.
  - 워크플로 파일은 이벤트의 커밋에 있는 버전을 쓴다. 원문: "Each workflow run will use the version of the workflow that is present in the associated commit SHA or Git ref of the event." [Workflows](https://docs.github.com/en/actions/concepts/workflows-and-actions/workflows) [문서]
- **사용자가 웹에서 Publish를 누르면 그 저장소의 `on: release: types: [published]` 워크플로가 돈다** [추론]
  - 이벤트를 만든 주체가 사용자이므로 아래 `GITHUB_TOKEN` 예외에 해당하지 않는다.
- **`GITHUB_TOKEN` 규칙** [문서: [GITHUB_TOKEN](https://docs.github.com/en/actions/concepts/security/github_token), [Triggering a workflow](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)]
  - 원문: "When you use the repository's `GITHUB_TOKEN` to perform tasks, events triggered by the `GITHUB_TOKEN` will not create a new workflow run" (예외: `workflow_dispatch`, `repository_dispatch`, 일부 `pull_request`)
  - 원문: "If you do want to trigger a workflow from within a workflow run, you can use a GitHub App installation access token or a personal access token instead of `GITHUB_TOKEN`"
  - 원문: "Commits pushed by a GitHub Actions workflow that uses the `GITHUB_TOKEN` do not trigger a GitHub Pages build."
- 이번 구조에 대입 [추론]
  - 초안을 만드는 것만으로는 어떤 토큰이든 워크플로가 돌지 않는다(초안의 `created`는 트리거하지 않음).
  - 공개를 사람이 웹에서 누르면 돈다.
  - 공개를 자동화한다면 토큰이 중요하다.
    - 같은 저장소의 `GITHUB_TOKEN`으로 공개하면 돌지 않는다.
    - PAT나 App 토큰으로 공개하면 돈다.
  - 다른 저장소 구조에서는 `stardraft`의 `GITHUB_TOKEN`이 `stardraft-releases`에 접근조차 못 하므로 이 규칙에 걸릴 일이 없다.
- **Pages 배포를 `release` 이벤트에서 할 때의 함정**
  - 환경(environment)의 배포 브랜치·태그 규칙은 `GITHUB_REF`와 비교한다. 원문: "The deployment branch or tag rule is matched against the `GITHUB_REF` of the workflow run." [Deployments and environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments) [문서]
  - Pages 커스텀 워크플로는 `github-pages` 환경을 쓴다. [Using custom workflows with GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages) [문서]
  - `release` 이벤트에서 Pages를 배포하다 "Tag 'v1.0.1' is not allowed to deploy to github-pages" 오류로 실패한 사례가 있다. [redis-om-spring PR #660](https://github.com/redis/redis-om-spring/pull/660) [이슈]
  - 자동 생성되는 `github-pages` 환경의 기본 규칙이 기본 브랜치만 허용한다는 점은 공식 문서에서 찾지 못했다 [추측].
  - 대응: 환경 규칙에 `v*` 태그 패턴을 더하거나, `release` 워크플로에서 `workflow_dispatch`로 기본 브랜치 배포를 부른다 [추론].

## 5. 용량과 이용 제한

### GitHub Releases

- [문서: [About releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases) "Storage and bandwidth quotas"]
  - "Up to 1000 release assets may be associated with a single release."
  - "Each file included in a release must be under 2 GiB."
  - "There is no limit on the total size of a release, nor bandwidth usage."
- 다른 문서는 개별 파일이 "the maximum file size limit for Git LFS on your plan"보다 작아야 한다고 적는다. 두 기준이 다르다. Free·Pro에서는 어느 쪽이든 2 GB 안팎이라 이 앱에는 영향이 없다 [문서: [About large files on GitHub](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github), 추론].
- 이용 정책상 과도한 대역폭은 제한될 수 있다. 원문: "we reserve the right to suspend your Account, throttle your file hosting, or otherwise limit your activity" [Acceptable Use Policies 9. Excessive Bandwidth Use](https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies#9-excessive-bandwidth-use) [문서]

### GitHub Pages

- [문서: [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits) (원본 커밋 2026-07-24)]
  - 소스 저장소 권장 한도 1 GB
  - "Published GitHub Pages sites may be no larger than 1 GB."
  - 배포가 10분을 넘으면 시간 초과
  - "*soft* bandwidth limit of 100 GB per month"
  - "*soft* limit of 10 builds per hour. This limit does not apply if you build and publish your site with a custom GitHub Actions workflow."
  - 요청이 많으면 `429`를 돌려줄 수 있다.
  - 한도를 넘으면 CDN을 앞에 두거나 "making use of other GitHub features such as releases"를 권하는 메일이 올 수 있다.
- 파일 크기
  - 브랜치에서 게시하면 Git 한도를 따른다. 원문: "GitHub blocks files larger than 100 MiB." [About large files on GitHub](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github) [문서]
  - Actions로 게시하면 산출물 tar가 10 GB 미만이어야 한다. 개별 파일 한도는 문서에 없다. [Using custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages), [upload-pages-artifact README](https://github.com/actions/upload-pages-artifact) [문서]
  - 추론: DMG를 Pages 산출물에 넣는 것도 가능은 하다. 다만 사이트 1 GB 한도 안에 버전을 쌓아야 하고, GitHub 스스로 큰 파일은 Releases를 쓰라고 권한다.
- 이용 정책
  - 원문: "GitHub Pages is not intended for or allowed to be used as a free web-hosting service to run your online business, e-commerce site, or any other website that is primarily directed at either facilitating commercial transactions or providing commercial software as a service (SaaS)." (위 limits 문서)
  - 원문: "GitHub Pages is intended to host static web pages, but primarily as a showcase for personal and organizational projects." [Terms for Additional Products and Features: Pages](https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features#pages) (원본 커밋 2026-09-16) [문서]
  - 원문: "GitHub Pages sites shouldn't be used for sensitive transactions like sending passwords or credit card numbers." (limits 문서)
  - 추론: 사내 도구의 다운로드·설치 안내 페이지는 판매나 SaaS 제공이 아니므로 금지 조항에 해당하지 않는다. 10명 규모면 대역폭도 문제 되지 않는다(예: 150 MB × 2개 × 10명 = 3 GB/버전).

## 6. 사용자 지정 도메인을 나중에 붙일 때

- **문서**
  - 사용자 사이트에 도메인을 붙이면 같은 계정의 프로젝트 사이트도 그 도메인 아래로 간다. 원문 예: "the GitHub Pages site for that repository will be available at `www.octocat.com/octo-project`." [About custom domains](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/about-custom-domains-and-github-pages) [문서]
  - 문서가 명시하는 자동 리디렉트는 apex ↔ `www` 사이뿐이다.
  - **`<user>.github.io/<repo>/`가 새 도메인으로 리디렉트된다는 문장은 현재 문서에서 찾지 못했다.**
- **[실측] 저장소에 자체 도메인을 둔 프로젝트 사이트**

| 요청 | 응답 |
|---|---|
| `https://jekyll.github.io/jekyll/docs/installation/` | 301 → `http://jekyllrb.com/docs/installation/` |
| `https://mermaid-js.github.io/mermaid/intro/` | 301 → `https://mermaid.js.org/intro/` |
| `https://twbs.github.io/bootstrap/docs/5.3/getting-started/introduction/?x=1` | 301 → `http://getbootstrap.com/docs/5.3/getting-started/introduction/?x=1` |

- 해석 [추론]
  - `/<repo>` 접두사를 떼고 나머지 경로와 쿼리를 유지한 채 301로 보낸다.
  - 대상 스킴(`http`/`https`)은 저장소의 "Enforce HTTPS" 설정을 따르는 것으로 보인다.
  - 그래서 처음에 `github.io` 주소로 공유한 링크는 도메인을 붙인 뒤에도 동작한다. 사용자 사이트 도메인을 프로젝트 사이트가 물려받는 경우는 실측하지 않았다.

## 7. GitHub REST API 비인증 호출 (브라우저에서)

- **한도** [문서: [Rate limits for the REST API](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) (원본 커밋 2026-09-29)]
  - 원문: "You can make unauthenticated requests if you are only fetching public data. Unauthenticated requests are associated with the originating IP address"
  - 원문: "The primary rate limit for unauthenticated requests is 60 requests per hour."
  - [실측] `GET /repos/electron/electron/releases` 응답에 `x-ratelimit-limit: 60`, `x-ratelimit-resource: core`
  - 조건부 요청(`304`)이 한도에서 빠지는 것은 "the request was made while correctly authorized with an `Authorization` header"일 때뿐이다. [Best practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api#use-conditional-requests) [문서] 비인증 브라우저 요청에는 해당하지 않는다 [추론].
  - 추론: 사무실 팀원이 같은 공인 IP(NAT)를 쓰면 60회를 나눠 쓴다. 페이지를 열 때마다 API를 부르는 구조는 피하는 편이 안전하다.
- **CORS** [문서: [Using CORS and JSONP](https://docs.github.com/en/rest/using-the-rest-api/using-cors-and-jsonp-to-make-cross-origin-requests) (원본 커밋 2026-06-23)]
  - 원문: "The REST API supports cross-origin resource sharing (CORS) for AJAX requests from any origin."
  - [실측] `Origin: https://example.com`으로 요청하면 `access-control-allow-origin: *`
- **비공개 저장소**: 비인증 요청으로는 받을 수 없다. "only fetching public data" 조건에 맞지 않는다 [문서·추론].
- **브라우저에서 자산 내용 읽기** [실측]
  - `github.com/.../releases/download/...`의 302 응답과 최종 `release-assets.githubusercontent.com`의 200 응답 모두 `Access-Control-Allow-Origin`이 없었다.
  - 추론: 사이트 JS가 `fetch`로 `SHA256SUMS.txt` 내용을 읽을 수는 없다. 링크로 내려받는 것은 CORS와 무관하다.
  - 대신 Release JSON의 자산마다 `digest`(`sha256:…`), `size`, `download_count`가 있다 [실측, 문서: [Releases](https://docs.github.com/en/rest/releases/releases) 응답 스키마의 `digest`]. 해시 표시는 이 값으로 할 수 있다 [추론].

## 8. 대안 호스팅 비교

### 정적 파일 하나당 크기 상한

| 서비스 | 파일당 상한 | 그 밖의 한도 | 출처 |
|---|---|---|---|
| Cloudflare Pages | **25 MiB** | Free 20,000파일, 유료 100,000파일. 빌드 월 500회(Free) | [Pages limits](https://developers.cloudflare.com/pages/platform/limits/) (Last updated 2026-09-05) [문서] |
| Cloudflare Workers 정적 자산 | **25 MiB** | Free 20,000파일, Paid 100,000파일 | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/#static-assets) (Last updated 2026-10-12) [문서] |
| Vercel | 개별 파일 상한은 문서에서 찾지 못함 | CLI로 올리는 소스 총량이 Hobby 100 MB, Pro 1 GB | [Limits](https://vercel.com/docs/limits#static-file-uploads) (last_updated 2026-09-16) [문서] |

- Cloudflare: 100 MB가 넘는 DMG는 사이트 배포물에 넣을 수 없다 [문서].
- Vercel
  - 원문: "When using the CLI to deploy, the maximum size of the source files that can be uploaded is limited to 100 MB for Hobby and 1 GB for Pro."
  - 2026-06-17 변경 기록은 "We've removed CLI-specific deployment limits"라고 적지만 어떤 한도인지 밝히지 않는다. [changelog](https://vercel.com/changelog/cli-deployment-limits-removed) 문서와 어긋나므로 실제 업로드로 확인해야 한다 [추론].
  - **Hobby는 상업적 이용 금지다.** 원문: "Hobby teams are restricted to non-commercial personal use only." 상업적 이용 정의는 "used for the purpose of financial gain of anyone involved in any part of the production of the project, including a paid employee or consultant writing the code." [Fair Use Guidelines](https://vercel.com/docs/limits/fair-use-guidelines#commercial-usage) (last_updated 2026-09-14) [문서]
  - 추론: 직원이 업무로 만든 사내 도구 사이트는 이 정의에 걸릴 가능성이 높다. Vercel을 쓰려면 Pro가 필요하다고 보는 편이 안전하다.
- 큰 파일을 Cloudflare에 두려면 R2를 쓴다 [문서]
  - 객체당 최대 약 5 TiB, 단일 업로드 5 GiB. [R2 limits](https://developers.cloudflare.com/r2/platform/limits/) (Last updated 2026-06-08)
  - 무료 10 GB-month, 송신(egress) 무료. [R2 pricing](https://developers.cloudflare.com/r2/pricing/) (Last updated 2026-10-01)

### Cloudflare Access(Zero Trust) 무료 플랜

- **인원** [문서: [Cloudflare plans](https://www.cloudflare.com/plans/) Zero Trust 표, 2026-10-16 조회]
  - Free: "$0 forever", "User Limit: 50 users", "Teams under 50 users or enterprise proof-of-concept tests."
  - Pay-as-you-go: 사용자당 월 7달러, 인원 제한 없음.
- **좌석 계산** [문서: [Seat management](https://developers.cloudflare.com/cloudflare-one/team-and-resources/users/seat-management/) (Last updated 2026-05-01)]
  - Access에 한 번 인증한 사용자가 좌석 하나를 쓴다. 지울 때까지 유지된다.
  - 원문: "Once the total amount of seats in the subscription has been consumed, additional users who attempt to log in are blocked."
- **이메일 일회용 코드** [문서: [One-time PIN login](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/) (Last updated 2026-08-31)]
  - 원문: "Cloudflare Access can send a one-time PIN (OTP) to approved email addresses as an alternative to integrating an identity provider."
  - 원문: "This secure PIN expires 10 minutes after the initial request."
  - 원문: "New Zero Trust organizations use the Cloudflare identity provider as their default login method. OTP is no longer added automatically". OTP는 직접 추가해야 한다.
  - 기본 로그인 방식인 Cloudflare IdP는 Cloudflare 계정 소속 여부로 판정한다. 팀원에게 Cloudflare 계정이 없다면 OTP를 쓰는 편이 맞다. [Cloudflare as identity provider](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/cloudflare/) (Last updated 2026-06-19) [문서·추론]
  - 정책에 `Emails ending in` `@회사도메인` 규칙을 쓸 수 있다. [Access policies](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/) (Last updated 2026-10-01) [문서]
- **전제 조건과 주의**
  - 공개 호스트명 앱을 Access로 막으려면 "An active domain on Cloudflare"가 필요하다. [Self-hosted public application](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/) (Last updated 2026-04-17) [문서]
  - Pages 문서는 프리뷰 배포를 Access로 막는 방법을 설명한다. [Preview deployments](https://developers.cloudflare.com/pages/configuration/preview-deployments/) 운영 `*.pages.dev` 주소를 막는 방법은 확인하지 않았다.
  - R2는 사용자 지정 도메인 뒤에서 Access로 막을 수 있다. 원문: "Disable public access to your `r2.dev` subdomain … If you do not disable public access, your bucket will remain publicly available through your `r2.dev` subdomain." [R2 public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/) (Last updated 2026-09-25) [문서]
  - 추론: 페이지만 Access로 막고 파일은 공개 GitHub Release에 두면, 파일 URL을 아는 사람은 누구나 받는다. 사내 한정이 의미 있으려면 파일도 Access 뒤(R2 등)에 있어야 한다.

## 9. 업데이트 설치 동작

### Windows: electron-builder NSIS 원클릭 설치 파일을 앱 실행 중에 실행

근거 소스는 태그 `electron-builder@26.17.0`의 `packages/app-builder-lib/templates/nsis/`다. npm `app-builder-lib@26.17.0` 패키지의 템플릿과 내용이 같은 것을 확인했다 [소스].

- **실행 순서** [소스: [installSection.nsh](https://github.com/electron-userland/electron-builder/blob/electron-builder%4026.17.0/packages/app-builder-lib/templates/nsis/installSection.nsh)]
  - 원클릭(`ONE_CLICK`)이면 진행 배너를 띄운 뒤 `CHECK_APP_RUNNING`을 실행한다(33행).
  - 그다음 이전 버전 제거(`uninstallOldVersion`), 파일 설치, 바로가기 생성 순서다.
  - `runAfterFinish` 기본값이 켜져 있어 설치 뒤 앱을 실행한다(91~103행, `NsisTarget` 425행).
- **실행 중인 앱 감지와 종료** [소스: [include/allowOnlyOneInstallerInstance.nsh](https://github.com/electron-userland/electron-builder/blob/electron-builder%4026.17.0/packages/app-builder-lib/templates/nsis/include/allowOnlyOneInstallerInstance.nsh) `_CHECK_APP_RUNNING`]
  - PowerShell을 쓸 수 있으면 실행 경로가 설치 폴더(`$INSTDIR`)로 시작하는 프로세스를 찾는다. 없으면 `tasklist`로 현재 사용자의 같은 exe 이름을 찾는다(64~79행).
  - 찾으면 `${isUpdated}`가 아닐 때 확인창을 띄운다(120행).
    ```nsis
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" /SD IDOK IDOK doStopProcess
    Quit
    ```
    - **확인(OK)**: 종료를 시도하고 설치를 이어 간다.
    - **취소**: `Quit`. 설치하지 않고 끝난다.
  - 종료 절차(123~161행)
    - `-Force` 없이 `Stop-Process`(PowerShell이 없으면 `taskkill`)를 부른다. 300 ms 기다린다.
    - 아직 있으면 1초 뒤 강제 종료(`Stop-Process -Force` 또는 `taskkill /F`)한다.
    - 그래도 안 닫히면 두 번째 시도부터 "닫을 수 없으니 직접 닫고 다시 시도"(`appCannotBeClosed`) 확인창을 띄운다. 다시 시도 또는 취소(설치 중단)를 고른다.
  - `Stop-Process`는 "implemented using the **Kill** method of the **System.Diagnostics.Process** class"다. [Stop-Process (PowerShell 5.1)](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.management/stop-process?view=powershell-5.1) (ms.date 2026-08-10) [문서]
    - 추론: OK를 누르면 앱은 정상 종료 절차(`before-quit` 등) 없이 즉시 끝난다. 쓰던 작업은 저장되지 않는다. 안내문에서 "설치 전에 트레이 메뉴에서 앱을 종료"하라고 하는 편이 안전하다.
  - `${isUpdated}`는 설치 파일을 `--updated` 인자로 실행했을 때만 참이다. electron-builder가 플래그마다 `StdUtils.TestParameter` 매크로를 만든다 [소스: `out/targets/nsis/nsisScriptGenerator.js` `flags()`, `NsisTarget.js` 596행]. 사용자가 직접 실행하면 거짓이라 확인창이 뜬다. `--updated`면 묻지 않고 1초 기다린 뒤 종료한다(108~119행).
- **확인창 문구** [소스: [messages.yml](https://github.com/electron-userland/electron-builder/blob/electron-builder%4026.17.0/packages/app-builder-lib/templates/nsis/messages.yml)]
  - `appRunning` 영어: "${PRODUCT_NAME} is running.\nClick OK to close it.\nIf it doesn't close, try closing it manually."
  - `appRunning` 한국어: "${PRODUCT_NAME}이(가) 실행 중입니다. \nOK을 클릭하면 종료됩니다."
  - 다국어 설치 파일이 기본이다(`multiLanguageInstaller` 기본값은 `unicode` 값, `unicode` 기본값 true). 기본 언어 목록에 `ko_KR`이 있다. 언어 선택 창(`displayLanguageSelector`) 기본값은 false이고 "by default will be detected using OS language"다 [소스: `nsisOptions.d.ts`, `nsisLang.js`, `util/langs.js`].
  - 추론: 한국어 Windows에서는 "Stardraft이(가) 실행 중입니다. OK을 클릭하면 종료됩니다." 창이 뜬다. 버튼 글자는 OS가 붙이므로 "확인"/"취소"로 보일 것이다.
- **기존 사용자 데이터(`%APPDATA%\Stardraft`)는 유지된다** [소스]
  - 이전 버전 제거는 옛 언인스톨러를 `/S /KEEP_APP_DATA <옵션> _?=<설치 폴더>`로 실행한다. 이때 `--delete-app-data`를 넘기지 않았다면 항상 `--updated`를 붙인다. 소스 주석: "always pass --updated flag - to ensure that if DELETE_APP_DATA_ON_UNINSTALL is defined, user data will be not removed" [[include/installUtil.nsh](https://github.com/electron-userland/electron-builder/blob/electron-builder%4026.17.0/packages/app-builder-lib/templates/nsis/include/installUtil.nsh) 201~230행]
  - 언인스톨러는 `--delete-app-data` 인자가 있거나, `DELETE_APP_DATA_ON_UNINSTALL`이 정의돼 있고 `--updated`가 아닐 때만 `$APPDATA\${APP_FILENAME}` 등을 지운다 [[uninstaller.nsh](https://github.com/electron-userland/electron-builder/blob/electron-builder%4026.17.0/packages/app-builder-lib/templates/nsis/uninstaller.nsh) 215~245행].
  - `deleteAppDataOnUninstall` 기본값은 false다("one-click installer only") [소스: `nsisOptions.d.ts`].
  - `/KEEP_APP_DATA`는 현재 템플릿 어디에서도 읽지 않는다. 실제로 데이터를 지키는 조건은 `--updated`와 위 기본값이다 [소스: 템플릿 전체 검색].
  - 추론: 설치 폴더 `%LOCALAPPDATA%\Programs\Stardraft`는 지우고 다시 깐다. 사용자 데이터는 반드시 `userData`(`%APPDATA%\Stardraft`)에 둬야 한다.
- 실기 확인은 하지 않았다. 이 Mac에는 Windows가 없다.

### macOS: 실행 중인 앱을 Applications의 새 버전으로 덮어쓸 때

- **근거 없음.** Apple 공식 문서에서 Finder가 실행 중인 앱 번들을 덮어쓸 때의 동작을 설명한 곳을 찾지 못했다. 실기 실험도 하지 않았다(Finder 자동화에 시스템 권한 확인이 필요해 생략).
- 추론: 안내문에서는 "새 버전을 넣기 전에 메뉴 막대 아이콘에서 Stardraft를 종료"하라고 쓰는 편이 안전하다. 덮어쓴 뒤 Keychain 재허용과 알림 권한 재확인이 생길 수 있다는 점은 [코드 서명 선택지 조사](code-signing-options.md)를 따른다.

## 10. Electron 44 최소 OS

- [문서: [README Platform support (44-x-y)](https://github.com/electron/electron/blob/44-x-y/README.md)]
  - "macOS (Ventura and up): Electron provides 64-bit Intel and Apple Silicon / ARM binaries for macOS."
  - "Windows (Windows 10 and up): Electron provides `x64` (`amd64`) and `arm64` binaries for Windows."
- [문서: [Breaking changes (44-x-y)](https://github.com/electron/electron/blob/44-x-y/docs/breaking-changes.md)]
  - "macOS 13 (Ventura) or later will be required to run Electron v44.0.0 and higher."
  - 32비트 Windows(`win32-ia32`) 바이너리는 더 이상 나오지 않는다.
- 아키텍처와 함께 보면 [추론]
  - DMG가 arm64뿐이라 Intel Mac은 실행할 수 없다.
  - Windows on Arm: "Windows 11 on Arm supports emulation of both x86 and x64 apps … Windows 10 on Arm also supports emulation, but only for x86 apps." [How emulation works on Arm](https://learn.microsoft.com/en-us/windows/arm/apps-on-arm-x86-emulation) (ms.date 2025-11-06) [문서]
    - 그래서 x64 설치 파일은 Windows 11 Arm에서는 에뮬레이션으로 돌 수 있고, Windows 10 Arm에서는 돌지 않는다. 실행해 보지는 않았다.
- 이 내용은 [Electron 빌드 스택 조사 F절](electron-build-stack.md#f-지원-os)과 같다.

## 11. 브라우저에서 방문자의 칩 판별

### API 지원 범위

- `navigator.userAgentData`와 `getHighEntropyValues()` [문서: MDN [browser-compat-data](https://github.com/mdn/browser-compat-data/blob/main/api/NavigatorUAData.json), 마지막 커밋 2026-08-17]
  - Chrome 90+, Edge·Opera(Chrome과 같음): 지원
  - Firefox, Safari: **미지원**
  - 실험 기능(experimental)이다. HTTPS 같은 보안 컨텍스트에서만 쓸 수 있다. [MDN Navigator.userAgentData](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/userAgentData)
  - Chrome 144부터 `ch-ua-high-entropy-values` 권한 정책으로 고엔트로피 값 반환을 제어할 수 있다(BCD 주석).
- **Chromium이 돌려주는 `architecture` 값** [소스: [user_agent_utils.cc `GetCpuArchitecture()`](https://github.com/chromium/chromium/blob/2d5b29ac606dbe80dc9ce1778e4edc7ec0b30a44/components/embedder_support/user_agent_utils.cc) 701~723행, 2026-10-07 커밋]
  - macOS: Intel이면 `"x86"`. Apple Silicon이거나 Rosetta로 번역 실행 중(`kTranslatedIntel`)이면 `"arm"`
  - Windows: ARM64이거나 ARM64 위에서 x86·x64 Chrome이 에뮬레이션으로 돌면 `"arm"`. x86·x64면 `"x86"`
  - 소스 주석: "When running a Chrome x86_64 (AMD64) build on an ARM64 device, the OS lies and returns 0x9 (PROCESSOR_ARCHITECTURE_AMD64)". 그래서 별도로 보정한다.
  - 결론: Chromium 계열 브라우저에서는 브라우저가 어떤 빌드든 기기의 아키텍처를 알 수 있다.

### Safari와 Firefox

- **Safari** [소스: WebKit]
  - `navigator.platform`은 macOS에서 항상 `"MacIntel"`이다. [NavigatorBase.cpp](https://github.com/WebKit/WebKit/blob/ce1fa925b83a6d324929839277036aaa2e30a652/Source/WebCore/page/NavigatorBase.cpp) 107~108행
  - UA 문자열도 `Macintosh; Intel Mac OS X 10_15_7`로 고정이다. [UserAgentMac.mm](https://github.com/WebKit/WebKit/blob/49a2b0400d3f6a16e8d604e112da4b38d22cbd02/Source/WebCore/platform/mac/UserAgentMac.mm) 39행
  - 결론: Safari는 Apple Silicon과 Intel을 구분할 수 없다.
- **Firefox** [소스: [nsHttpHandler.cpp](https://github.com/mozilla-firefox/firefox/blob/5eac64c02dde01154daa11ea38eaa544bc188812/netwerk/protocol/http/nsHttpHandler.cpp) 1195~1220행, 2026-10-15 커밋]
  - macOS UA의 OS 부분은 `Intel Mac OS X 10.15`로 고정이다.
  - Windows ARM64는 Windows 11 이상에서 `Win64; x64`로 보고한다. 소스 주석: "Report ARM64 Windows 11+ as x86_64 and Windows 10 as x86." x64 PC와 구분할 수 없다.
  - `userAgentData`도 없다(위 BCD).
- **Chromium의 UA 문자열도 고정이다** [소스: user_agent_utils.cc 298~300행]
  - macOS `Macintosh; Intel Mac OS X 10_15_7`, Windows `Windows NT 10.0; Win64; x64`
  - 그래서 UA 문자열이 아니라 `userAgentData`를 써야 한다.
- `navigator.platform`은 Windows에서 64비트여도 `"Win32"`를 돌려준다. MDN은 이 값을 "unreliable"하다며 권하지 않는다. [MDN Navigator.platform](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/platform) [문서]
- WebGL 렌더러 문자열로 GPU 이름을 추정하는 방법이 알려져 있지만 공식 판별 수단이 아니다. 확인하지 않았다 [추측].

### 사용자가 직접 확인하는 방법 (안내문용)

- Mac: Apple 메뉴 > 이 Mac에 관하여. Apple 실리콘이면 "'칩'이라고 표시된 항목이 나타나고", Intel이면 "'프로세서'라고 표시된 항목이 나타나고"다. [Apple 실리콘이 탑재된 Mac 컴퓨터](https://support.apple.com/ko-kr/116943) (게시일 2026-05-15) [문서]
- Windows: 설정 > 시스템 > 정보의 "장치 사양". 바로가기 `ms-settings:about` [어떤 버전의 Windows 운영 체제를 실행하고 있나요?](https://support.microsoft.com/ko-kr/windows/%EC%96%B4%EB%96%A4-%EB%B2%84%EC%A0%84%EC%9D%98-windows-%EC%9A%B4%EC%98%81-%EC%B2%B4%EC%A0%9C%EB%A5%BC-%EC%8B%A4%ED%96%89%ED%95%98%EA%B3%A0-%EC%9E%88%EB%82%98%EC%9A%94-628bec99-476a-2c13-5296-9dd081cdd808) [문서]. 이 문서는 x64와 ARM을 구분하는 항목 이름을 적지 않는다.

## 12. 스마트 앱 컨트롤 확인 경로 (Windows 11 한국어)

- **경로** [문서: [Windows 보안 앱의 앱 & 브라우저 컨트롤 (ko-kr)](https://support.microsoft.com/ko-kr/windows/app-browser-control-in-the-windows-security-app-8f68fb65-ebb4-3cfb-4bd7-ef0f376f3dc3)]
  - 원문: "PC의 Windows 보안 앱에서 앱 & 브라우저 컨트롤 > 스마트 앱 컨트롤 설정을 선택하거나 다음 바로 가기를 사용합니다."
  - 문서의 바로가기 링크는 `windowsdefender://smartapp/`다. 앱 & 브라우저 컨트롤 페이지는 `windowsdefender://appbrowser/`다.
  - 영어판 경로: "In the Windows Security app on your PC, select App & browser control > Smart App Control settings"
- **상태 이름** [문서: 같은 한국어 문서]
  - "평가 모드": 적합한 후보인지 판단하는 기간. 원문: "스마트 앱 컨트롤은 평가 모드에 있는 동안 아무 것도 차단하지 않습니다."
  - "켜기": "예측 모델에서 신뢰하거나 유효한 서명이 있는 앱이 실행됩니다."
  - "끄기": "수동으로 꺼져 있거나 평가 모드 중에 적합한 후보가 아닌 것으로 확인된 경우에 발생할 수 있습니다."
  - 영어판은 "Evaluation mode", "On", "Off"다.
- **Windows 10에는 없다** [문서]
  - 원문: "스마트 앱 컨트롤은 Windows 10에서 사용할 수 없습니다." (같은 한국어 문서)
  - SAC FAQ 한국어판의 적용 대상도 "Windows 11"뿐이다. [스마트 앱 컨트롤이란?](https://support.microsoft.com/ko-kr/topic/what-is-smart-app-control-285ea03d-fa88-4d56-882e-6698afdb7003)
  - Windows 11 22H2부터 들어갔다는 근거는 [코드 서명 선택지 조사 1절](code-signing-options.md#sac가-기본으로-켜지는-조건)에 있다.
- **주의할 점**
  - 같은 한국어 문서 안에서도 표기가 섞여 있다. 메뉴는 "앱 & 브라우저 컨트롤", 소개 문단은 "앱 & 브라우저 제어 페이지"라고 쓴다. 앞선 조사 안내문은 "앱 및 브라우저 컨트롤"이라고 썼다. **실제 Windows 11 한국어 UI 문구는 실기로 확인하지 않았다.**
  - 상태 이름도 지원 문서는 "평가 모드"라고 쓰지만, 설정 화면의 라디오 버튼 문구가 "평가"인지 "평가 모드"인지는 확인하지 않았다.
  - 같은 문서에 "스마트 앱 컨트롤은 새 Windows 11 설치에서만 사용할 수 있습니다"라는 옛 문장이 남아 있다. 2026년 KB 릴리스 노트로는 재설치 없이 켜고 끌 수 있게 바뀌고 있다([코드 서명 선택지 조사](code-signing-options.md#sac가-기본으로-켜지는-조건)).

## 확인하지 못한 것

1. **비공개 자산의 서명 URL**: 토큰으로 비공개 저장소 자산을 요청했을 때 로그인 없이 열리는 서명 URL이 오는지, 유효 시간이 얼마인지. 공개 자산으로만 300초를 확인했다.
2. **초안 Release의 태그 생성 시점**: 초안 단계에서 태그를 만들지 않는다는 것은 커뮤니티 보고뿐이다. 사용자 계정에 저장소를 만들어 시험하지 않았다.
3. **`github-pages` 환경의 기본 배포 규칙**: 태그 ref에서 배포가 막히는지는 이슈 사례로만 봤다.
4. **사용자 사이트 도메인을 물려받는 프로젝트 사이트의 리디렉트**: 저장소에 자체 도메인을 둔 경우만 실측했다.
5. **Vercel 파일 크기**: 개별 정적 파일 상한, 2026-06 변경 기록과 한도 문서의 불일치.
6. **Cloudflare Access로 운영 `*.pages.dev` 주소를 막는 방법**: 사용자 지정 도메인 없이 되는지 확인하지 않았다.
7. **Windows 실기 전체**: NSIS 확인창, 강제 종료, 한국어 문구, 데이터 보존, Windows 11 Arm에서 x64 설치 파일 실행을 실기로 보지 않았다.
8. **macOS Finder 덮어쓰기**: 공식 근거도 실측도 없다.
9. **Windows 11 한국어 UI 문구**: "앱 및 브라우저 컨트롤"과 "앱 & 브라우저 컨트롤", "평가"와 "평가 모드" 중 실제 화면 문구.

## 결정에 주는 함의 (추론)

결정은 티켓에서 한다. 위 사실에서 바로 나오는 제약만 적는다.

- **GitHub만으로 가는 길**
  - 공개 저장소(`stardraft-releases` 등)를 하나 두면 Free로 Pages와 Release를 함께 쓸 수 있다.
  - 비용이 들지 않고 비로그인 다운로드가 된다. 대신 사이트와 파일이 모두 공개다.
  - 비공개 `stardraft`에서 그 저장소로 올리려면 PAT나 GitHub App 비밀값이 하나 더 필요하다.
  - 공개 저장소의 태그와 "Source code" 압축 파일은 앱 소스와 무관하다는 점을 감안한다.
- **사내 한정이 필요하면**
  - GitHub로는 개인 계정에서 방법이 없다.
  - Cloudflare Access(50명 무료, 이메일 OTP)가 가장 가깝다. 다만 Cloudflare에 올린 도메인이 필요하다. 파일도 Access 뒤(R2 등)에 둬야 의미가 있다.
- **사이트 구현**
  - 브라우저에서 GitHub API를 매번 부르면 같은 IP 60회 한도를 나눠 쓴다. 공개 시점에 워크플로가 버전·파일·해시(`digest`)를 정적 데이터로 만들어 배포하는 편이 단순하다.
  - Mac 칩 자동 판별은 Safari에서 안 된다. "Apple Silicon 전용"을 문구로 밝히고 확인 방법을 안내해야 한다.
- **설치 안내**
  - Windows: "설치 전에 앱을 종료하세요. 실행 중이면 설치 프로그램이 묻고, 확인을 누르면 강제로 닫습니다. 설정과 데이터는 그대로 남습니다."
  - macOS: 덮어쓰기 동작 근거가 없으므로 "앱을 종료한 뒤 응용 프로그램 폴더로 옮기세요"로 쓴다.

## 추가 확인 (2026-10-16~17)

[다운로드 사이트 형태 결정](../issues/09-download-site.md)을 진행하면서 메인 세션이 직접 확인했다. 이 결과로 위 "확인하지 못한 것" 1번이 풀렸다.

- **비공개 자산의 서명 URL** [실측]
  - 사용자 계정의 다른 비공개 저장소(Release 자산 약 134MiB)로 확인했다.
  - `Accept: application/octet-stream`과 토큰으로 자산 API를 부르면 `release-assets.githubusercontent.com`으로 302가 온다.
  - 그 URL을 인증 없이 `Range: bytes=0-99`로 요청하니 `206`이 왔다.
  - URL의 `se` 값은 요청 시각보다 약 55분 뒤였다. 공개 자산에서 본 300초보다 길다.
- **`release` 이벤트의 `released` 활동 유형** [문서]
  - 정의는 "A release was published, or a pre-release was changed to a release."다.
  - `published`는 "A release, pre-release, or draft of a release was published."다.
  - 출처는 [github/docs의 webhook 스키마 원본](https://github.com/github/docs/blob/main/src/webhooks/data/fpt/release.json)과 [Events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#release)다.
- **immutable releases** [문서]
  - 2025-10-28에 정식 출시됐다. 공개한 Release의 자산과 태그를 바꾸거나 지울 수 없다.
  - 제목과 노트는 고칠 수 있고, 사전 릴리스 표시와 latest 지정도 바꿀 수 있다.
  - 문서는 초안에 자산을 모두 붙인 뒤 공개하라고 권한다.
  - 요금제나 비공개 저장소에 따른 제한은 문서에 나와 있지 않다.
  - 출처는 [Immutable releases](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases)와 [출시 공지](https://github.blog/changelog/2025-10-28-immutable-releases-are-now-generally-available/)다.
- **Vercel Hobby 이용 조건** [문서]
  - "Hobby teams are restricted to non-commercial personal use only."
  - 상업적 이용의 정의는 "any Deployment that is used for the purpose of financial gain of anyone involved in any part of the production of the project, including a paid employee or consultant writing the code"이다.
  - 예시는 결제 요청, 판매 광고, 사이트 제작·호스팅 대가, 제휴 링크가 주목적인 사이트, 광고 게재다.
  - 무료 한도는 한 달에 Fast Data Transfer 100 GB, 함수 호출 100만 회다.
  - 출처는 [Fair Use Guidelines](https://vercel.com/docs/limits/fair-use-guidelines)(2026-09-14 수정)다.
- **Vercel Deploy Hook** [문서]
  - GET이나 POST로 호출하고, 인증 헤더가 필요 없다. 그래서 URL 자체를 비밀값으로 다룬다.
  - 프로젝트당 5개, 시간당 60회까지다.
  - 출처는 [Deploy Hooks](https://vercel.com/docs/deploy-hooks)(2026-09-16 수정)다.
  - 결정에서는 요청할 때 조회하는 방식을 골라서 쓰지 않는다.
