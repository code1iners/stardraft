# 따라잡기와 중복 억제

Map: [Sentry 오류 이슈 진단 보고서](../map.md)
Type: grilling
Mode: HITL
Status: open
Blocked by:

## Question

감지는 조직 단위 이슈 목록 API 폴링이다(신규는 `firstSeen` 체크포인트, 재발은 `is:regressed`, [감지 조사](01-sentry-detection-auth-research.md)). PC가 꺼져 있던 동안 쌓인 오류 이슈를 어떻게 따라잡고, 같은 오류 이슈를 거듭 진단하지 않는 기준을 무엇으로 둘지 정한다. 제약은 [API 조사](../research/sentry-api-facts.md)에 있다.

- **따라잡기 범위**: 앱을 다시 켰을 때 체크포인트 이후의 신규 오류 이슈를 모두 진단할지, 개수·기간 상한을 둘지. 상한을 넘긴 것은 어떻게 남길지.
- **놓친 재발**: 재발 상태는 7일 뒤 `ongoing`으로 바뀐다. 그보다 오래 꺼져 있던 동안의 재발은 되찾을 수 없다는 점을 받아들일지.
- **중복 억제 키**: 재발마다 남는 `SET_REGRESSION` 활동(`event_id`·`version`)을 키로 쓸지, 오류 이슈당 진단 간격을 둘지. 진단 중·검토 대기 중인 오류 이슈가 또 재발하면 어떻게 할지.
- **`escalating`**: 보관 뒤 다시 늘어나는 오류 이슈는 지금 전제("해결 후 재발")에 들지 않는다. 이대로 둘지 확인한다.
- **폴링 주기와 rate limit**: 주기, 여러 조직·지역(`regionUrl`)일 때의 순서, 429를 받았을 때의 물러남.
