# 진단 보고서의 형식과 저장 위치

Map: [Sentry 오류 이슈 진단 보고서](../map.md)
Type: prototype
Mode: HITL
Status: resolved
Blocked by:

## Question

진단 보고서에 무엇을 어떤 순서로 담고, 검토 후 어디에 어떤 이름으로 저장할지 정한다. 실제 Sentry 오류 이슈 하나를 예로 보고서 시안을 2~3개 만들어 비교한다.

- 섹션 후보: 요약, 오류 이슈 정보(링크·첫 발생·발생 수·release), 재현 결과(성공·실패·불가와 사용한 방법·명령·스크린샷), 원인과 확신도, **근거**(코드 위치), 개선 방향, 남은 의문.
- 에이전트 결과 스키마로 받을 부분과 앱이 채울 부분의 구분.
- 저장 위치 후보: 앱 데이터 폴더, 사용자가 정한 폴더, 매핑된 저장소 안(예: `docs/diagnoses/`). 파일 이름 규칙.
- 재현 중 생긴 스크린샷·로그 같은 첨부의 보관 방식.

## Comments

- 2026-11-12 시안: `~/.claude-mukkebi/mockups/stardraft/diagnosis-report-format.html` (A 결론 먼저 · B 조사 기록 · C 가설 표 · 저장 위치·첨부 비교). 예시 오류 이슈는 가상이다.
- 시안 원본은 버리는 브랜치 `prototype/sentry-diagnosis-report-format`(커밋 `5fdf8c5`)의 `.scratch/sentry-diagnosis/prototypes/diagnosis-report-format.html`에 있다.

## Answer

2026-11-12 시안 비교와 grilling으로 정했다. "파일로 저장"은 앱 안 저장과 헷갈려 **내보내기**로 부르기로 했고, 진단 보고서를 끝내는 것은 내보내기가 아니라 **완료**다.

### 형식

- 순서는 시안 A(결론 먼저)다. 제목 → 요약 → 재현(성공·실패·불가) → 원인과 확신도 → 개선 방향 → 근거 → 남은 의문 → 오류 이슈 정보 → 실행 정보.
- 재현이 실패·불가일 때만 재현 칸에 "시도한 것" 목록을 넣는다(시안 B에서 가져옴). 가설 표(시안 C)는 쓰지 않고 "남은 의문"으로 대신한다.

### 채우는 주체

- **앱**이 채운다.
  - 제목(오류 이슈 제목)
  - 오류 이슈 정보: Sentry 링크·`shortId`, 조직·프로젝트, 환경, 레벨, 신규·재발 구분과 감지 시각, 첫 발생·최근 발생, 발생 수·사용자 수, release(최초·최근·재발), 플랫폼, culprit, 소스맵 적용 여부
  - 실행 정보: 저장소 경로, HEAD 해시, 커밋하지 않은 변경 유무, 에이전트와 버전, 재현 허용 여부, 걸린 시간, 생성 시각
  - 에이전트가 답할 수 없는 재현 결과: "불가(허용 안 됨)", "불가(시간 초과)"
- **에이전트** 결과 스키마로 받는다.

```
summary: string
reproduction: {
  result: success | failure | impossible
  impossible_reason: no_tool | insufficient_data | env_failed | null
  method: string
  steps: string[]          // 실패·불가면 시도한 것
  attachments: string[]    // 재현 사본 안 경로
}
cause: { text: string, confidence: high | medium | low }
improvements: string[]
open_questions: string[]
evidence: [{ id, explanation, repository, path, start_line, end_line }]
```

- `evidence`는 Flow 초안의 `draftOutputSchema`(`core/drafts/draft.ts`)와 같은 형식이라 근거 표시를 공유할 수 있다. 정확한 필드 이름·문장별 근거 연결 여부는 스펙에서 다듬는다.

### 내보내기

- 진단 보고서를 앱 밖의 마크다운 파일로 만드는 **선택** 동작이다. 완료 전에는 언제든, 몇 번이든 할 수 있다. 지시로 다시 진단한 뒤 또 내보내도 된다.
- 위치는 설정의 폴더 하나이고 기본값은 `~/Documents/Stardraft/Reports/Sentry/`다. 매번 묻지 않는다. `Sentry/` 아래 구조는 다른 프로바이더의 보고서가 생기면 옆에 폴더를 두기 위한 것이다.
- 파일 이름은 `YYYY-MM-DD-<Sentry 프로젝트 slug>-<shortId>.md`, 날짜는 오류 이슈를 감지한 날이다.
- 같은 이름이 있으면 덮어쓰지 않고 `-2`, `-3`을 붙인다.

### 첨부

- 이미지(`png`·`jpg`)와 텍스트 로그(`log`·`txt`)만 받는다. 보고서 하나에 최대 10개, 합계 20MB. 넘는 것은 옮기지 않고 본문에 "첨부 n개 생략"을 적는다.
- 재현 사본을 지우기 전에 앱이 첨부를 앱 데이터 폴더의 그 진단 아래로 옮긴다([재현 실행의 보안 경계](05-reproduction-security-boundary.md)).
- 내보낼 때 보고서와 같은 이름의 폴더(`<파일 이름>/`)에 복사하고 상대 링크로 건다.

### 완료

- 진단 보고서를 끝내는 동작은 **완료** 하나다. Flow의 "무시" 같은 별도 동작은 두지 않는다.
- 완료하면 Flow의 `archiveBundles`처럼 최소 기록(오류 이슈 id·상태·완료 시각 등)만 남기고 본문과 첨부는 앱에서 지운다.
- 내보내지 않고 완료하면 "내용이 사라진다"는 확인을 한 번 띄운다.
- 완료는 Sentry 오류 이슈의 상태(해결·보관)를 바꾸지 않는다.

### 다른 티켓으로 넘긴 것

- 진단 보고서를 앱 안에서 고칠 수 있는지, 검토 화면의 모양: 지도의 "검토 화면과 알림".
- 최소 기록을 어디에 둘지(`state.db`와 계정 리셋): 지도의 "Sentry 실행 상태의 저장 위치".
- 이벤트 데이터가 부족할 때 보고서 모양(`insufficient_data`의 기준): 지도의 "실패 처리".
