# Sentry 설정 칸·저장소 매핑·온보딩 화면 시안

Map: [Sentry 오류 이슈 진단 보고서](../map.md)
Type: prototype
Mode: HITL
Status: open
Blocked by:

## Question

[Sentry 계정 연결, 진단 대상 필터, 저장소 매핑 설정](04-sentry-connection-and-mapping.md)에서 정한 동작을 화면으로 어떻게 보여 줄지 시안 2~3개를 비교해 정한다. `ui-design`을 함께 쓰고, 지금 설정 창(`renderer/src/SettingsView.tsx`, `FlowAccountSection.tsx`, `RepositoriesSection.tsx`, `Onboarding.tsx`)의 패턴을 따른다.

- `Sentry` 칸: 토큰 입력과 두 단계 연결 확인, 조직별 프로젝트 목록에서 등록, 프로젝트마다 환경·레벨 필터, "접근 불가"와 "토큰 확인 필요" 상태 표시.
- `저장소` 칸: 저장소 매핑을 "Flow 프로젝트"·"Sentry 프로젝트" 묶음으로 나누는 방식, 등록했지만 매핑이 없는 Sentry 프로젝트를 드러내는 방식.
- 온보딩 체크리스트: 필수(에이전트 연결, 작업 폴더)와 선택(Flow, Sentry)을 구분하는 방식, 연결된 프로바이더가 없을 때의 안내.
