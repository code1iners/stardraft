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
- 저장소마다 **재현 허용** 켜기와 **재현용 환경 파일** 선택(파일 선택기), 노출 경고 문구. 정한 동작은 [재현 실행의 보안 경계](05-reproduction-security-boundary.md)에 있다.
- 앱 전체의 **재현 도구 권한**: `자동`(기본값)과 `직접 선택`(MCP 서버마다 켜고 끄기), `자동`에서 외부로 보내는 MCP도 실린다는 안내.
- 온보딩 체크리스트: 필수(에이전트 연결, 작업 폴더)와 선택(Flow, Sentry)을 구분하는 방식, 연결된 프로바이더가 없을 때의 안내.

## Comments

- 2026-11-12: [저장소 매핑이 없는 Sentry 프로젝트의 오류 이슈 처리](06-unmapped-sentry-project.md)에서 정한 사항이다. Sentry 매핑은 프로젝트 하나에 **저장소 하나**이고, 같은 저장소를 여러 Sentry 프로젝트에 매핑할 수 있다. 매핑이 없는 등록 프로젝트에는 "저장소 매핑 없음 · 진단 보류"를 표시한다. 시안에서 Sentry 묶음의 저장소 선택을 단일 선택으로 그린다.
