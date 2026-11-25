# 스펙 쓰기

Map: [Sentry 오류 이슈 진단 보고서](../map.md)
Type: task
Mode: HITL
Status: open
Blocked by:

## Question

닫힌 티켓의 결정을 모아 구현 착수용 스펙 `.scratch/sentry-diagnosis/spec.md`를 쓴다. 이 지도의 목적지다.

- **틀**: 어떤 틀로 쓸지. 처음 Flow 스펙(`.scratch/flow-mention-drafter/spec.md`)의 짜임을 따를지 먼저 정한다.
- **어긋남 맞추기**: 뒤 티켓이 앞 티켓의 결정을 바꾼 곳(작업 폴더 폐지, 병렬 작업 수, 목적지에 더한 Flow 기록의 계정별 보관 등)을 찾아 최신 결정으로 맞춘다. 서로 부딪히는 결정이 남아 있으면 사용자에게 묻는다.
- **답 없이 시안대로 적은 것**: [진단 보고서 검토 화면 시안](20-diagnosis-review-ui-prototype.md)과 [저장소 대기 상태 표시와 알림 시안](21-repo-blocked-and-notification-ui-prototype.md)에 "답 없이 시안대로 적었다"고 남긴 항목을 스펙에 넣기 전에 확인받는다.
- **스펙에서 채울 것**: 각 티켓이 "스펙에서 정한다"로 미룬 항목(알림 문구, 표마다의 계정 열 등)을 채운다.
- **처음 Flow 스펙과의 관계**: 이 스펙이 바꾸는 Flow 동작(작업 폴더·자동 선택 폐지, 계정을 바꿀 때의 기록 보관, 알림 규칙)을 어디에 적을지 정한다.
