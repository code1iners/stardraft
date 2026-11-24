# 진단 보고서 검토 화면 시안

Map: [Sentry 오류 이슈 진단 보고서](../map.md)
Type: prototype
Mode: HITL
Status: open
Blocked by: 18, 19

## Question

진단 보고서를 앱에서 검토하는 화면을 시안으로 정한다. 보고서의 구성은 [보고서 형식](07-diagnosis-report-format.md), 상태 목록은 [진단 실패와 데이터 부족의 처리](18-diagnosis-failure-handling.md), 다시 진단·수정 동작은 [다시 진단(지시)과 보고서 수정](19-rediagnosis-and-report-editing.md)을 따른다.

- **목록**: 오류 이슈 진단이 Flow 초안 목록과 한 목록에 섞이는지, 따로 나뉘는지. `ReviewSnapshot`에 `diagnoses`를 따로 두기로 했다([경계 결정](08-provider-seam-decision.md)).
- **보고서 보기**: 결론 먼저 형식의 배치, 첨부(이미지·로그) 보기, 메타데이터와 실행 정보의 자리.
- **버튼의 자리**: **내보내기**·**완료**, 다시 진단, 실패한 진단의 다시 시도.
- **상태별 모양**: 진행 중·실패·재현 불가인 진단이 어떻게 보이는지.
- **Flow 초안 검토 화면과의 공유**: 같은 틀을 쓰는 부분과 갈리는 부분.

화면 문구는 쉬운 말로 쓰고 특정 서비스 이름에 묶지 않는다([병렬 작업 수 시안](14-concurrency-setting-ui-prototype.md)).
