# `diagnosing-bugs` 절차의 전달 방식

Map: [Sentry 오류 이슈 진단 보고서](../map.md)
Type: grilling
Mode: HITL
Status: open
Blocked by:

## Question

차팅 전제는 "앱이 에이전트에게 `diagnosing-bugs` 절차와 재현 도구 사용을 허용한 **지침**을 넘긴다"이다. 지침은 Sentry 대상 어댑터가 만든다([경계 결정](08-provider-seam-decision.md)). 그 절차를 에이전트에게 어떻게 전달할지 정한다.

- **스킬 가정인가, 지침에 직접 넣는가**: 사용자 에이전트에 `diagnosing-bugs` 스킬이 설치되어 있다고 가정할지, 절차 본문을 앱이 지침에 넣을지. Claude는 `--restricted`, Codex는 `--ignore-user-config`로 돌므로 사용자 스킬이 실리는지부터 확인한다.
- **절차의 출처와 갱신**: 직접 넣는다면 원문을 앱에 싣는 방식(복사본, 버전), 앱에 맞게 줄이거나 고칠 부분(대화형 단계, 사람에게 묻는 단계는 무인 실행에서 쓸 수 없다).
- **읽기 전용 진단의 지침**: **재현 허용**이 꺼진 진단은 읽기 전용으로 낮춘다. 그때 절차의 어느 부분을 빼는지.
- **결과 스키마와의 연결**: 절차의 산출(재현 성공·실패·불가, 원인, 확신도)이 [보고서 형식](07-diagnosis-report-format.md)의 에이전트 결과 스키마에 어떻게 대응하는지.
