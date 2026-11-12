# Sentry 오류 이슈 감지·인증 API 사실 조사

- 조사일: 2026-11-12
- 티켓: [01 Sentry 오류 이슈 감지와 인증 조사](../issues/01-sentry-detection-auth-research.md)
- 출처 범위: docs.sentry.io(API 문서 `https://docs.sentry.io/api/` 하위와, 같은 사이트의 검색 문법·토큰·웹훅 문서), getsentry/sentry 저장소 코드. 블로그·서드파티 글은 쓰지 않았다.
- 코드 인용은 조사 시점의 `master` 커밋 `303713e42286b191f567931ef9999c4c3a9373ef`에 고정했다. 아래에서 `src/...`는 `https://github.com/getsentry/sentry/blob/303713e42286b191f567931ef9999c4c3a9373ef/src/...`를 줄인 것이다.
- **검증 수준: 모든 항목이 "문서 근거"다.** 실제 Sentry 계정으로 호출해 보지 않았다. 코드에서 읽은 것은 "코드 근거"로 따로 표시했다. sentry.io에 배포된 버전이 이 커밋과 같다는 보장은 없다.
- 용어: GLOSSARY.md를 따른다. **오류 이슈**는 Sentry의 issue(내부 이름 Group), **이벤트**는 그 오류 이슈에 묶인 개별 발생 하나다.

## 요약 (이후 결정 티켓용)

### 계정 연결·필터·매핑 티켓에 쓸 것

1. **토큰은 개인 토큰(Personal Token, User Auth Token)이 사실상 유일한 선택지다.** 최소 scope는 `org:read` + `event:read` 두 개다. 조직 목록·조직의 프로젝트 목록은 `org:read`, 오류 이슈 목록·상세·이벤트는 `event:read`로 읽는다. `project:read`는 이 흐름에 필요 없다(문서 근거).
2. **조직 토큰(Organization Auth Token)은 쓸 수 없다.** 권한이 `org:ci` 하나로 고정이라 오류 이슈를 못 읽는다(코드 근거). Internal Integration은 조직 하나에 묶이고 웹훅 중심이며, OAuth는 30일 만료와 조직 하나 선택 제약이 있다.
3. **개인 토큰은 만료가 없고(코드 근거), 사용자가 언제든 회수할 수 있으며, 만든 뒤 scope를 바꿀 수 없다**(문서 근거). 토큰을 만든 사용자가 조직을 떠나면 동작을 멈춘다.
4. **서버 쪽 필터:** `environment`는 오류 이슈 목록 API의 쿼리 파라미터로 거른다. `level`은 검색 쿼리(`level:error` 등)로 거른다. 프로젝트는 `project` 파라미터를 반복해 여러 개를 한 번에 지정한다. 플랫폼은 프로젝트 목록의 `platform`이나 오류 이슈의 `platform` 필드로 받아서 판단한다.
5. **저장소 매핑 화면 데이터:** `GET /api/0/organizations/`(조직 목록, `links.regionUrl` 포함) → `GET /api/0/organizations/{org}/projects/`(프로젝트 목록, `slug`·`platform`·`environments` 포함). 둘 다 쪽당 최대 100개, `Link` 헤더 커서로 쪽을 넘긴다.
6. **지역 도메인:** sentry.io 조직은 미국(`us.sentry.io`)과 독일(`de.sentry.io`) 지역으로 나뉜다. 조직 목록 응답의 `links.regionUrl`을 저장해 이후 호출의 기준 주소로 쓰는 편이 안전하다. 조직 목록이 "그 지역에서 접근 가능한 조직"만 돌려준다는 문구가 있어, 한 주소로 모든 지역 조직이 나오는지는 확인 못 함.

### 따라잡기·중복 억제 티켓에 쓸 것

1. **감지는 폴링으로 가능하다.** 엔드포인트는 `GET /api/0/organizations/{org}/issues/` 하나다(프로젝트별 엔드포인트는 폐기 예정). 신규와 재발은 쿼리 두 개로 나눈다.
   - 신규: `query=is:unresolved firstSeen:>{체크포인트 ISO-8601}` + `sort=new` (+ 선택적으로 `is:new`)
   - 재발: `query=is:regressed` + `sort=date`
2. **`is:new`·`is:regressed`는 문서 표에는 없지만 코드에서 유효한 검색 값이다.** 오류 이슈의 `substatus`(new·regressed·ongoing·escalating 등)로 바뀐다(코드 근거). 응답에도 `substatus` 필드가 있다.
3. **둘 다 7일 뒤 자동으로 `ongoing`으로 바뀐다**(코드 근거). 그래서 앱이 7일 넘게 꺼져 있었다면 `is:new`·`is:regressed`로는 놓친 것을 찾을 수 없다. 신규는 `firstSeen` 체크포인트로 따라잡을 수 있지만, **재발은 목록 API에 "재발 시각" 필드가 없어** 7일이 지난 재발은 목록만으로 되찾을 수 없다.
4. **재발 중복 억제 키:** 오류 이슈 id만으로는 부족하다(같은 오류 이슈가 해결→재발을 여러 번 겪는다). 오류 이슈 상세의 `activity`에 `set_regression` 활동이 남고, 그 `data`에 재발을 일으킨 `event_id`와 `version`이 들어간다(코드 근거, 문서 예시에는 이 활동이 안 나온다). **`(오류 이슈 id, set_regression 활동 id 또는 dateCreated)`**를 키로 쓰는 안이 가장 근거가 있다.
5. **재발은 "해결됨" 상태에서만 생긴다.** 보관(archived)된 오류 이슈가 다시 늘면 재발이 아니라 `escalating`이다. 또 "다음 릴리스에서 해결"로 처리됐는데 이벤트가 그 릴리스보다 오래된 릴리스에서 오면 재발로 치지 않는다(코드 근거).
6. **호출 수:** 프로젝트 수와 무관하게 폴링 한 바퀴는 목록 호출 2회(+쪽 넘김)이고, 새로 잡힌 오류 이슈마다 최신 이벤트 1회, 재발마다 상세 1회가 더해진다. 오류 이슈 목록 GET의 한도는 사용자당 초당 10회, 조직당 초당 20회다(코드 근거). 문서는 "폴링은 금방 rate limit에 걸린다"고 경고한다.
7. **진단 데이터:** `GET /api/0/organizations/{org}/issues/{issue_id}/events/latest/` 하나로 스택트레이스·breadcrumbs·request·user·contexts·release·tags·platform을 받는다. **`environment`와 `level`은 이벤트 응답의 최상위 필드가 아니라 `tags` 배열 안에 있다.**

## 1. 감지 수단

### 1-1. 오류 이슈 목록 API (폴링의 기반)

| 항목 | 내용 | 출처 |
| --- | --- | --- |
| 경로 | `GET /api/0/organizations/{organization_id_or_slug}/issues/` | [List an Organization's Issues](https://docs.sentry.io/api/events/list-an-organizations-issues/) |
| scope | `event:admin`, `event:read`, `event:write` 중 하나 | 같은 문서. 코드의 `OrganizationEventPermission` GET도 같다(`src/sentry/api/bases/organization.py` L209-215) |
| 기본 쿼리 | `query`를 안 보내면 `is:unresolved`가 적용된다. 전부 받으려면 빈 문자열 | 같은 문서, `src/sentry/api/helpers/group_index/index.py` L49 |
| 정렬 `sort` | `date`(Last Seen), `new`(First Seen), `trends`, `freq`(Events), `user`(Users), `inbox`(Date Added), `recommended` | 같은 문서 |
| 기본 정렬 | `date` (마지막 발생 순) | 코드 근거: `src/sentry/constants.py` L288 `DEFAULT_SORT_OPTION = "date"`, `index.py` L90 |
| 정렬 키 매핑 | `date` → `last_seen`, `new` → `first_seen` | 코드 근거: `src/sentry/search/snuba/executors.py` L1237-1240 |
| `limit` | 최대 100 | 문서. 기본값은 문서에 없고, 검색 백엔드 기본이 100이다(코드 근거: `src/sentry/search/snuba/backend.py` L442) |
| 프로젝트 필터 | `project` 배열(ID 또는 slug). 생략하거나 `-1`이면 접근 가능한 모든 프로젝트 | 문서 |
| 환경 필터 | `environment` 배열 | 문서 |
| 기간 | `statsPeriod`(예: `24h`, `14d`) 또는 `start`/`end`(ISO-8601). `statsPeriod`가 우선 | 문서 |
| 통계 기간(검색 기간과 별개) | `groupStatsPeriod`: `''`, `24h`, `14d`, `auto`만 허용 | 코드 근거: `src/sentry/issues/endpoints/organization_group_index.py` L78, L359 |
| `collapse` | `base`, `filtered`, `lifetime`, `stats`, `unhandled` — 응답을 줄여 성능 개선 | 문서 |
| 응답 필드 | `id`, `shortId`, `title`, `culprit`, `level`, `platform`, `status`, `substatus`, `statusDetails`, `firstSeen`, `lastSeen`, `count`, `userCount`, `project`, `permalink`, `metadata`, `isUnhandled`, `issueCategory`, `issueType`, `priority` 등 | 문서 응답 예시 |
| 프로젝트별 목록 API | `GET /api/0/projects/{org}/{project}/issues/` — **Deprecated**. 조직 목록 API로 대체됐다고 명시. 응답 예시에 `substatus`가 없다 | [List a Project's Issues](https://docs.sentry.io/api/events/list-a-projects-issues/) |

검색 기간을 주지 않을 때(`statsPeriod`·`start`·`end` 모두 생략) 기본 기간이 얼마인지는 확인 못 함. 코드에서 `get_date_range_from_stats_period(request.GET, optional=True)`로 None을 허용하는 것까지만 확인했다(`organization_group_index.py` L300). 폴링에서는 명시적으로 기간을 주는 편이 안전하다.

### 1-2. 신규·재발을 구분하는 검색 문법

| 검색 키 | 의미 | 출처 |
| --- | --- | --- |
| `is:unresolved` / `resolved` / `archived` / `for_review` 등 | 문서 표에 있는 `is` 값 | [Issue Properties](https://docs.sentry.io/concepts/search/searchable-properties/issues/) |
| `is:new`, `is:regressed`, `is:ongoing`, `is:escalating`, `is:archived_until_escalating` 등 | **문서 표에는 없다.** 코드에서 `SUBSTATUS_UPDATE_CHOICES`의 모든 키가 `is:` 값으로 등록되어 `substatus` 필터로 바뀐다 | 코드 근거: `src/sentry/issues/issue_search.py` L48-60, `src/sentry/types/group.py` L35-43 |
| `substatus:regressed` 등 | 위와 같은 의미의 직접 키 | 코드 근거: `issue_search.py` value_converters의 `"substatus"` |
| `firstSeen` (`age`와 동의어) | 처음 발생 시각으로 거른다. `age:-24h`(최근 24시간 안에 생김) 같은 상대 시각 | 문서. 코드에서 `first_seen`의 별칭이 `age`, `firstSeen`(`issue_search.py` L74) |
| `lastSeen` | 마지막 발생 시각. `lastSeen:-2d` | 문서, `issue_search.py` L75 |
| 절대 시각 비교 | `firstSeen:>2026-11-12T00:00:00Z`처럼 `>`, `>=`, `<`, `<=`, `=`, `!=`와 ISO-8601을 쓸 수 있다 | 코드 근거: 검색 문법 `date_filter = search_key sep operator iso_8601_date_format`(`src/sentry/api/event_search.py` L90, L217, L230), `first_seen`·`last_seen`이 날짜 키(`issue_search.py` L67). 문서는 상대 시각만 예시로 든다 |
| `level` | "Severity of the event (such as: fatal, error, warning)" | 문서 |
| `release`, `firstRelease`, `regressed_in_release` | 릴리스 관련 필터. `regressed_in_release`는 코드에만 있다 | 문서, `issue_search.py` value_converters |
| `issue.category` | `error`, `performance` 등. 오류만 받으려면 `issue.category:error` | 문서 |

`substatus` 값 정의(코드 근거, `src/sentry/types/group.py` L6-19):

- 미해결(UNRESOLVED) 상태의 하위 상태: `escalating`, `ongoing`, `regressed`, `new`
- 보관(IGNORED) 상태의 하위 상태: `archived_until_escalating`, `archived_until_condition_met`, `archived_forever`

### 1-3. 재발이 생기는 조건 (코드 근거)

`src/sentry/event_manager.py` L1786-1822 `_handle_regression`:

- 오류 이슈가 **해결됨(resolved)일 때만** 재발 처리한다. 보관 상태면 재발이 아니다.
- "특정 릴리스에서 해결"로 처리됐고 들어온 이벤트의 릴리스가 그보다 새롭지 않으면 재발로 치지 않는다(`GroupResolution.has_resolution`).
- 커밋으로 해결 대기 중이면 재발로 치지 않는다.
- 재발이면 `status=unresolved`, `substatus=regressed`, `active_at`·`last_seen`을 그 이벤트 시각으로 바꾸고, `SET_REGRESSION` 활동을 남긴다. 활동 `data`에는 `event_id`, `version`(릴리스), `event_title` 등이 들어간다(같은 파일 L1885-1895 부근).
- 활동 타입 `SET_REGRESSION = 6`(`src/sentry/types/activity.py` L10). API 응답의 문자열 이름이 `set_regression`이라는 것은 문서 예시로 확인하지 못했다(문서 예시는 `first_seen`만 보여 준다). 확인 못 함.

### 1-4. 7일 뒤 `ongoing` 자동 전환 (코드 근거)

- `src/sentry/issues/ongoing.py` L13 `TRANSITION_AFTER_DAYS = 7`
- `src/sentry/tasks/auto_ongoing_issues.py`: `NEW`인 오류 이슈는 생성 후 7일이 지나면, `REGRESSED`인 오류 이슈는 마지막 재발 기록(GroupHistory REGRESSED) 후 7일이 지나면 `ONGOING`으로 바뀐다.
- 결과: `is:new`·`is:regressed`는 "최근 7일 안의 신규·재발" 필터처럼 동작한다. 따라잡기 기간이 7일을 넘으면 이 필터로는 놓친다.

### 1-5. 쪽 나눔과 커서

| 항목 | 내용 | 출처 |
| --- | --- | --- |
| 방식 | `Link` 헤더. 예: `<https://sentry.io/api/0/organizations/acme/issues/123456/events/?&cursor=0:100:0>; rel="next"; results="true"; cursor="0:100:0"` | [Pagination](https://docs.sentry.io/api/pagination/) |
| `results` | `results="true"`면 그 방향에 데이터가 더 있다. 다음 쪽 `results="false"`가 마지막 | 같은 문서 |
| 항상 반환 | 지원하는 엔드포인트는 이전·다음 커서를 빈 쪽이어도 항상 준다. 문서는 이것이 "새 데이터를 폴링할 수 있게" 하려는 것이라고 한다 | 같은 문서 |
| 커서 형식 | `식별자:오프셋:is_prev`. 예 `0:100:0` | 같은 문서 |
| 오류 이슈 검색의 커서 | 정렬 값 기반이다. 코드 주석에 "a cursor there becomes a HAVING on last_seen"(`executors.py` L1541)이 있다. 커서 문자열을 폴링 사이에 저장해 재사용하는 방식이 안정적인지는 확인 못 함 | 코드 근거 |

**권장 폴링 방식(위 사실에서 끌어낸 설계안, 검증 안 됨):**

- 폴링 사이 상태는 커서가 아니라 **시각 체크포인트**로 저장한다. 신규는 `firstSeen:>{체크포인트}` + `sort=new`로 받고, 한 바퀴 안에서만 `Link`의 `rel="next"`가 `results="true"`인 동안 커서로 쪽을 넘긴다.
- 재발은 `is:regressed` + `sort=date`로 받고, 결과 오류 이슈마다 로컬 기록(이미 처리한 재발 키)과 비교한다. 재발 키는 상세 API의 `activity` 중 재발 활동으로 정한다(아래 4-2).
- 오류 이슈 하나가 신규이면서 7일 안에 해결→재발하면 두 쿼리에 모두 나올 수 있으니 중복 억제가 필요하다.

### 1-6. 다른 감지 수단과 비교

| 수단 | 내용 | 데스크톱 앱 적합성 | 출처 |
| --- | --- | --- | --- |
| 폴링(오류 이슈 목록 API) | 위 1-1~1-5 | 공개 주소 불필요. 적합 | 위 출처 |
| Integration 웹훅(issue 리소스) | `action`이 `created`, `resolved`, `assigned`, `archived`, `unresolved`. 해결된 오류 이슈가 재발하면 `unresolved`로 온다 | 웹훅 수신 주소가 필요하다(Integration 설정에서 웹훅 URL을 받는 구조). 데스크톱 앱에는 부적합. 공개 URL이 필수라는 문장은 문서에서 확인 못 함 | [Issue webhooks](https://docs.sentry.io/organization/integrations/integration-platform/webhooks/issues/) |
| Rate limit 문서의 권고 | "Polling the API for updates is likely to quickly trigger rate limiting." 가능하면 웹훅을 쓰라고 권한다 | 폴링 간격을 넉넉히 잡아야 한다 | [Rate Limits](https://docs.sentry.io/api/ratelimits/) |

폴링이 막히는 경우의 대안: 웹훅을 받아 줄 중계 서버를 두거나(앱 범위 밖), 폴링 간격을 늘리고 `collapse`로 응답을 줄이는 것 정도다. 그 밖의 1차 출처 대안은 찾지 못했다.

## 2. 인증

| 토큰 | 만드는 곳·사람 | scope | 만료 | 회수 | 이 앱에 쓰기 | 출처 |
| --- | --- | --- | --- | --- | --- | --- |
| 개인 토큰(Personal / User Auth Token) | User settings > Personal Tokens. 누구나 만들 수 있다 | 만들 때 고른다. **만든 뒤 바꿀 수 없다.** 만든 사용자의 권한을 넘지 못한다 | **없음** — 생성 시 `expires_at=None`(코드 근거) | 사용자가 언제든 회수. 회수된 토큰은 401 | **적합.** 사용자가 접근 가능한 모든 조직·프로젝트에 닿는다. 사용자가 조직을 떠나면 멈춘다 | [Auth Tokens](https://docs.sentry.io/account/auth-tokens/), [API Auth](https://docs.sentry.io/api/auth/), 코드 `src/sentry/api/endpoints/api_tokens.py` L104-111 |
| 조직 토큰(Organization Auth Token) | 누구나 자기 조직용으로 만들 수 있다 | **바꿀 수 없음.** CI·Sentry CLI용 제한 권한 | 문서에 없음 | 조직 owner·manager만 회수 | **부적합.** 허용 scope가 `org:ci` 하나뿐이라 오류 이슈를 못 읽는다(코드 근거) | [Auth Tokens](https://docs.sentry.io/account/auth-tokens/), 코드 `src/sentry/models/orgauthtoken.py` L32-36 |
| Internal Integration 토큰 | 조직의 Internal Integration을 만들면 생긴다. 누가 만들 수 있는지는 문서에서 확인 못 함 | 사용자 지정, 나중에 수정 가능. 조직 하나에 묶임 | 문서에 없음 | 문서에 없음 | 가능하지만 조직 단위 관리자 작업이 필요하고, 조직마다 따로 만들어야 한다 | [Auth Tokens](https://docs.sentry.io/account/auth-tokens/), [API Auth](https://docs.sentry.io/api/auth/) |
| OAuth2 액세스 토큰 | PKCE 인증 코드 흐름 또는 기기 인증 흐름 | `scope` 파라미터로 요청 | **30일**, refresh token으로 갱신 | 회수 시 401 | OAuth 앱 등록이 필요하다. "사용자가 OAuth 흐름에서 고른 조직 하나"에만 접근 | [API Auth](https://docs.sentry.io/api/auth/) |
| DSN 인증 | `Authorization: DSN {DSN}` | 매우 제한적, 지원 엔드포인트만 | — | — | 부적합 | [API Auth](https://docs.sentry.io/api/auth/) |
| 레거시 API 키 | HTTP Basic | — | — | — | 새 계정에서 비활성화. 쓰지 않는다 | [API Auth](https://docs.sentry.io/api/auth/) |

헤더 형식: `Authorization: Bearer {TOKEN}`([API Auth](https://docs.sentry.io/api/auth/)).

### 2-1. 최소 읽기 scope

[Permissions & Scopes](https://docs.sentry.io/api/permissions/)의 GET 열과 각 엔드포인트 문서를 맞춰 본 결과:

| 필요한 호출 | scope | 출처 |
| --- | --- | --- |
| 조직 목록 `GET /api/0/organizations/` | `org:read` (또는 `org:write`, `org:admin`) | [List Your Organizations](https://docs.sentry.io/api/users/list-your-organizations/) |
| 조직의 프로젝트 목록 `GET /api/0/organizations/{org}/projects/` | `org:read` (또는 `org:write`, `org:admin`) — `project:read`가 아니다 | [List an Organization's Projects](https://docs.sentry.io/api/organizations/list-an-organizations-projects/) |
| 오류 이슈 목록·상세 | `event:read` | 1-1, [Retrieve an Issue](https://docs.sentry.io/api/events/retrieve-an-issue/) |
| 이벤트 조회 | `event:read` | [Retrieve an Issue Event](https://docs.sentry.io/api/events/retrieve-an-issue-event/) |

**결론: `org:read` + `event:read`.** `event:write`·`event:admin`은 오류 이슈 변경용이고, 이벤트 자체는 바꿀 수 없다(Permissions 문서). `project:read`는 프로젝트 상세(`/api/0/projects/{org}/{project}/`)가 필요해질 때만 더한다. 개인 토큰은 scope를 나중에 못 바꾸므로, 연결 화면 안내에서 처음부터 정확한 scope를 고르게 해야 한다.

## 3. 필터 (환경·레벨)

| 대상 | 서버 쪽 필터 | 방법 | 출처 |
| --- | --- | --- | --- |
| 환경 | 가능 | 목록 API의 `environment` 쿼리 파라미터(배열). 최신 이벤트 API에도 `environment` 파라미터가 있어 "그 환경의 최신 이벤트"를 받을 수 있다 | [List an Organization's Issues](https://docs.sentry.io/api/events/list-an-organizations-issues/), [Retrieve an Issue Event](https://docs.sentry.io/api/events/retrieve-an-issue-event/) |
| 레벨 | 가능 | 검색 쿼리 `level:error`, `level:fatal` 등. 응답의 `level` 필드로 받아서 다시 확인할 수도 있다 | [Issue Properties](https://docs.sentry.io/concepts/search/searchable-properties/issues/), 목록 응답 예시 |
| 레벨 여러 값 | `level:[error,fatal]` 같은 목록 문법이 오류 이슈 검색에서 되는지 | 확인 못 함 | — |
| 프로젝트 | 가능 | `project` 파라미터 반복 | 목록 API 문서 |
| 오류 종류 | 가능 | `issue.category:error`로 성능 이슈 등을 뺀다 | [Issue Properties](https://docs.sentry.io/concepts/search/searchable-properties/issues/) |

## 4. 진단 데이터

### 4-1. 최신 이벤트 API

| 항목 | 내용 | 출처 |
| --- | --- | --- |
| 경로 | `GET /api/0/organizations/{org}/issues/{issue_id}/events/{event_id}/`, `event_id` 자리에 `latest`, `oldest`, `recommended`를 쓸 수 있다 → **`.../issues/{issue_id}/events/latest/`** | [Retrieve an Issue Event](https://docs.sentry.io/api/events/retrieve-an-issue-event/) |
| scope | `event:read` (또는 write/admin) | 같은 문서 |
| 쿼리 | `environment`, `start`/`end`, `statsPeriod`, `collapse=adjacentEvents`(이전·다음 이벤트 id 조회 생략), `llmFormat=json|markdown|xml`(응답에 `formatted` 필드 추가) | 같은 문서 |

응답 안에서 각 데이터의 위치(같은 문서 응답 예시, 이벤트 직렬화 코드 `src/sentry/api/serializers/models/event.py` L470-500):

| 데이터 | 위치 |
| --- | --- |
| 스택트레이스 | `entries[]` 중 `type == "exception"` → `data.values[]` → `stacktrace.frames[]`. 프레임마다 `filename`, `absPath`, `lineNo`, `colNo`, `inApp`, `function`, `module`, `package`, `platform`, `context`(줄 번호·소스 줄 쌍), `vars` |
| 예외 정보 | 같은 `data.values[]`의 `type`, `value`, `mechanism.handled` |
| 원본(변환 전) 스택 | 같은 위치의 `rawStacktrace`(프레임 형식 동일) |
| breadcrumbs | `entries[]` 중 `type == "breadcrumbs"` → `data.values[]`. 각 `category`, `level`, `timestamp`, `message`, `data`, `type` |
| request | `entries[]` 중 `type == "request"` → `data.url`, `method`, `query`, `headers`, `cookies`, `env`, `data` |
| user | 최상위 `user`: `id`, `name`, `username`, `email`, `ip_address`, `data` |
| contexts | 최상위 `contexts`: `browser`, `os`, `trace` 등 |
| release | 최상위 `release` 객체: `version`, `dateCreated`, `dateReleased`, `lastCommit` 등 |
| tags | 최상위 `tags`: `{key, value}` 배열 |
| **environment** | **최상위 필드 없음.** `tags` 안의 `key == "environment"` |
| **level** | **최상위 필드 없음.** `tags` 안의 `key == "level"`. 오류 이슈 단위 레벨은 목록·상세 응답의 `level` |
| 플랫폼 | 최상위 `platform`(예 `javascript`). `sdk.name`·`sdk.version`, `contexts.os`로 보완 |
| 처리 오류 | 최상위 `errors[]`. 예: `js_invalid_sourcemap_location` "Invalid location in sourcemap" |
| 발생 시각 | `dateCreated`, `dateReceived` |

주의: 공유용 직렬화(`SharedEventSerializer`)는 breadcrumbs를 뺀다(`event.py` L760). 토큰으로 부르는 위 API가 이 직렬화를 쓰지는 않는 것으로 보이지만, 어느 직렬화를 쓰는지 엔드포인트 코드까지 따라가 확인하지는 않았다.

### 4-2. 오류 이슈 상세 (재발 키·릴리스)

- `GET /api/0/organizations/{org}/issues/{issue_id}/`, scope `event:read`. 응답에 `activity`, `firstRelease`, `lastRelease`, `status`, `substatus`, `statusDetails`, `platform`, `level`, `firstSeen`, `lastSeen`, `tags`(키별 요약)가 있다. `collapse=release,stats,tags`로 줄일 수 있다([Retrieve an Issue](https://docs.sentry.io/api/events/retrieve-an-issue/)).
- 문서 예시의 `activity`에는 `first_seen`만 보인다. 재발 활동이 여기에 나온다는 것은 코드(1-3)에서 끌어낸 추론이다.

### 4-3. 소스맵 적용 여부 구분

- 이벤트 문서: `errors[]`의 소스맵 관련 오류(`js_invalid_sourcemap_location` 등)와 `rawStacktrace`·`stacktrace`가 함께 있다는 것만 보인다. 둘의 차이와 처리 상태 필드는 문서에 설명이 없다.
- 코드 근거(`src/sentry/lang/javascript/processing.py` L59-68): JS 소스맵 처리 결과로 프레임의 `data`에 `sourcemap`(사용한 소스맵 URL), `sourcemap_origin`, `resolved_with`, `symbolicated`(bool)가 붙는다. 처리 오류는 `missing_sourcemap`, `malformed_sourcemap` 등으로 `errors`에 남는다(L138-164).
- 코드 근거(`src/sentry/interfaces/exception.py` L205-228): `raw_stacktrace`는 변환 전 프레임이 있을 때만 채워진다.
- 정리: **프레임 `data.symbolicated`/`data.sourcemap` 존재, `rawStacktrace` 존재, `errors[]`의 소스맵 오류**로 판단할 수 있다. API 응답에서 프레임 `data`가 그대로 노출되는지는 실제 응답으로 확인 못 함. iOS·Android(네이티브·ProGuard) 심볼화 표시는 조사하지 않았다.
- 참고: 프로젝트 목록 응답에 `hasMinifiedStackTrace` 플래그가 있다(의미는 문서에 없음).

## 5. 한도와 비용

| 항목 | 내용 | 출처 |
| --- | --- | --- |
| 단위 | "호출자와 엔드포인트의 조합"마다 적용. 초당 요청 수(고정 창)와 동시 요청 수 두 가지 | [Rate Limits](https://docs.sentry.io/api/ratelimits/) |
| 토큰 여러 개로 우회 | 불가. 토큰이 아니라 호출자 신원 기준 | 같은 문서 |
| 응답 헤더 | `X-Sentry-Rate-Limit-Limit`, `-Remaining`, `-Reset`(UTC epoch 초), `-ConcurrentLimit`, `-ConcurrentRemaining` | 같은 문서 |
| 엔드포인트별 숫자 | 문서에 없음 | — |
| 오류 이슈 목록 GET 한도 | IP당 10/초, 사용자당 10/초, 조직당 20/초 | 코드 근거: `organization_group_index.py` L281-288 |
| 한도 초과 시 상태 코드 | 문서에 없음(429로 추정되지만 확인 못 함) | — |
| 폴링 경고 | "Polling the API for updates is likely to quickly trigger rate limiting." | 같은 문서 |
| 무료 플랜 제약 | API 문서에는 플랜별 API 한도가 없다. 무료 플랜의 사용자 수·보존 기간 등은 1차 출처 범위(API 문서·저장소)에서 확인 못 함 | — |

호출 수 계산(위 사실에서의 추정): 한 조직의 프로젝트 N개를 감시해도 `project`를 반복 지정하면 폴링 한 바퀴 = 신규 쿼리 1회 + 재발 쿼리 1회(+100개 넘으면 쪽 수만큼). 새로 잡힌 오류 이슈마다 최신 이벤트 1회, 재발마다 상세 1회가 더해진다. 조직이 M개면 M배. 초당 한도에 비해 여유가 크지만, 같은 사용자가 Sentry 웹 UI를 쓰는 트래픽과 사용자당 한도를 나누는지는 확인 못 함.

## 6. 조직·프로젝트 목록

| 호출 | 내용 | 출처 |
| --- | --- | --- |
| `GET /api/0/organizations/` | scope `org:read`. `owner`, `query`, `sortBy`(`members`/`events`), `per_page`(기본·최대 100), `cursor`. 응답 `id`, `slug`, `name`, `links.regionUrl`(예 `https://us.sentry.io`), `links.organizationUrl`. "API key 기반 요청은 그 키의 조직만" 돌려준다. "인증된 세션이 그 지역에서 접근 가능한 조직"을 돌려준다고 적혀 있다 | [List Your Organizations](https://docs.sentry.io/api/users/list-your-organizations/) |
| `GET /api/0/organizations/{org}/projects/` | scope `org:read`. `per_page`(기본·최대 100), `cursor`, `query`(이름·slug). 응답 `id`, `slug`, `name`, `platform`, `platforms`, `isMember`, `hasAccess`, `environments`, `teams`, `latestRelease`, `hasMinifiedStackTrace` 등 | [List an Organization's Projects](https://docs.sentry.io/api/organizations/list-an-organizations-projects/) |
| 지역 도메인 | 기본은 `sentry.io`, 지역 도메인 `us.sentry.io`·`de.sentry.io`를 쓰면 지연이 줄어든다 | [API 개요](https://docs.sentry.io/api/) |

매핑 화면에서 환경 선택지를 보여 주려면 프로젝트 목록의 `environments`를 쓸 수 있어 보이지만, 이 필드의 정의는 문서에 없다.

## 7. 자가 호스팅

API 경로(`/api/0/...`)는 같은 getsentry/sentry 코드에서 나오므로 기준 주소만 자가 호스팅 서버로 바꾸면 되고, `us.`/`de.` 지역 도메인은 해당하지 않는다. API 인증 문서는 Internal Integration 토큰이 자가 호스팅에서도 된다고 적는다([API Auth](https://docs.sentry.io/api/auth/)). 자가 호스팅 버전이 오래됐으면 `substatus`·`is:regressed`가 없을 수 있다(검증은 범위 밖).

## 확인 못 함 목록

- `is:new`·`is:regressed`가 문서화된 공개 검색 값인지(코드에는 있으나 문서 표에 없음)
- 검색 기간을 생략했을 때의 기본 기간
- 폴링 사이에 커서 문자열을 저장해 재사용하는 방식의 안정성
- 오류 이슈 상세 `activity`에서 재발 활동의 문자열 이름(`set_regression`으로 추정)과 노출 여부
- `level:[error,fatal]` 같은 목록 문법 지원
- 한도 초과 시 HTTP 상태 코드, 엔드포인트별 공식 숫자(코드 값만 확인)
- 무료 플랜의 API 관련 제약
- 개인 토큰 하나로 미국·독일 지역 조직이 한 번에 나열되는지
- Internal Integration을 누가 만들고 어떻게 회수하는지
- 이벤트 응답에서 프레임 `data`(소스맵 정보) 노출 여부, 네이티브 플랫폼의 심볼화 표시
