# Sentry 오류 이슈 감지와 인증 조사

Map: [Sentry 오류 이슈 진단 보고서](../map.md)
Type: research
Mode: AFK
Status: resolved
Blocked by:

## Question

데스크톱 앱이 sentry.io에서 **새로 생기거나 재발한 오류 이슈**를 감지하고 진단에 필요한 데이터를 가져올 수 있는 방법을 1차 출처(Sentry 공식 API 문서, 공식 저장소)로 확인한다.

1. **감지 수단**: 데스크톱 앱은 웹훅을 받을 공개 주소가 없다. 폴링으로 새 이슈와 재발(regression) 이슈를 구분해 찾을 수 있는지 확인한다(이슈 목록 API의 검색 쿼리 `is:unresolved`, `firstSeen`, `is:regressed` 등, 정렬과 쪽 나눔). 웹훅·Integration 등 다른 수단과 비교하고, 폴링이 안 되는 경우의 대안을 적는다.
2. **인증**: 개인이 발급할 수 있는 토큰 종류(User Auth Token, Organization Auth Token, Internal Integration)와 각각 필요한 최소 scope(읽기 전용), 만료와 회수 방식을 확인한다.
3. **필터**: 환경(`environment`)과 레벨(`level`)로 서버 쪽에서 거를 수 있는지, 아니면 받아서 걸러야 하는지 확인한다.
4. **진단 데이터**: 오류 이슈의 최신 이벤트에서 스택트레이스(파일 경로·줄 번호·in_app 여부), breadcrumbs, release, tags, request·user 컨텍스트, 플랫폼(web/iOS/Android 등)을 가져오는 API를 확인한다. 소스맵이 적용된 스택인지 구분할 수 있는지도 본다.
5. **한도와 비용**: rate limit, 프로젝트 여러 개를 폴링할 때의 호출 수, 무료 플랜 제약.
6. **조직·프로젝트 목록**: 사용자가 접근 가능한 조직과 프로젝트 목록을 가져오는 API. 저장소 매핑 설정 화면이 이 목록을 쓴다.
7. 서버 주소를 바꿔 자가 호스팅에 붙일 때 경로 차이가 있는지 한 줄만 적는다(검증은 범위 밖).

결과는 `../research/sentry-api-facts.md`에 쓰고 이 티켓에서 링크한다. 실제 Sentry 계정으로 확인하지 못한 항목은 문서 근거만 있다고 표시한다.

## Answer

모든 항목은 문서 근거(docs.sentry.io API 문서와 getsentry/sentry 코드)이며 실제 계정으로는 검증하지 않았다.

- 감지는 `GET /api/0/organizations/{org}/issues/` 폴링으로 할 수 있다. 신규는 `is:unresolved firstSeen:>{체크포인트}` + `sort=new`, 재발은 `is:regressed` + `sort=date`로 나눈다. `is:new`·`is:regressed`는 문서 표에는 없고 코드에서 `substatus` 필터로 확인했다. 둘 다 7일 뒤 `ongoing`으로 자동으로 바뀌고 목록 응답에 재발 시각이 없어서, 7일 넘게 놓친 재발은 되찾을 수 없다.
- 인증은 개인 토큰에 `org:read` + `event:read`가 최소 scope다. 개인 토큰은 만료가 없고 사용자가 회수할 수 있으며 scope를 나중에 바꿀 수 없다. 조직 토큰은 `org:ci`만 가져 쓸 수 없다.
- `environment`는 쿼리 파라미터로, `level`은 검색 쿼리(`level:error`)로 서버에서 거를 수 있다. 프로젝트는 `project`를 반복해 한 번에 지정하므로 호출 수가 프로젝트 수와 무관하다. 목록 GET 한도는 사용자당 초당 10회다(코드 값).
- 진단 데이터는 `.../issues/{issue_id}/events/latest/`로 받는다. 스택·breadcrumbs·request는 `entries[]`에, release·user·contexts·platform은 최상위에 있다. `environment`·`level`은 이벤트의 `tags` 안에만 있다.
- 재발 중복 억제 키는 오류 이슈 id만으로는 부족하다. 상세 `activity`의 재발 활동(코드상 `SET_REGRESSION`)과 함께 써야 한다.

결과: [sentry-api-facts.md](../research/sentry-api-facts.md)
