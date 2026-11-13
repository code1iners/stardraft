# Flow 댓글 `systemCode` 해석 조사

- 조사일: 2026-11-12 (API 포털 v2.1.0 계열 기준. 포털 버전 표기는 [flow-api-facts.md](flow-api-facts.md)와 같은 번들을 읽었다)
- 질문: 댓글 목록 응답의 `systemCode`를 어떻게 해석해야 하는가. 특히 `S13`이 사람이 쓴 글에 붙는가.
- 조사 방법
  - 공개 API 포털(`https://api.flow.team/docs`)은 SPA라서 엔드포인트 설명이 HTML에 없다. 공개 JS 번들(`_app/immutable/nodes/23.0ad7db5e.js`)의 문서 텍스트를 읽었다.
  - Flow 웹 클라이언트의 공개 JS(`common.min.js`, `detail.min.js`)를 읽었다. 로그인 없이 받을 수 있는 정적 파일이다.
  - 로그인이 필요한 페이지, 라이브 API 호출, 개인 정보 외부 전송은 하지 않았다.
  - 저장소 안의 기존 실호출 기록(`flow-alarm-probe-result.json`)을 대조했다.
- 한 줄 결론: **공식 API 문서는 `systemCode`를 "시스템 댓글 코드"라고만 적고 값 목록·의미를 정의하지 않는다.** 공식 클라이언트 코드와 실호출 기록을 맞추면 `S13`은 "이미지 첨부" 표시이고, 첨부가 있는 일반 댓글에도 붙는다(추정, 강한 정황).

## 1. 공식 API 문서에 정의된 내용 (검증된 사실)

- `GET /user/comments/{postId}`(댓글), 대댓글 목록 응답 모두에 `systemCode` 필드가 있다.

  | 필드 | 타입 | 필수 | 설명(원문) | 문서 예시 값 |
  | :- | :- | :- | :- | :- |
  | `systemCode` (댓글) | string | 아니오 | "시스템 댓글 코드" / 영문판 "System comment code" | `""` |
  | `systemCode` (대댓글) | string | 아니오 | "시스템 대댓글 코드" / 영문판 "System reply code" | `""` |

- 문서에는 이것이 전부다. 값 목록, `S13`을 포함한 개별 코드의 의미, 코드 문자열의 구조(`^^` 구분 등), "비어 있으면 사람 글"이라는 규칙은 **어디에도 없다**. 문서의 응답 예시는 `systemCode: ""` 한 가지뿐이다.
- 같은 문서 번들에서 `systemCode`, `시스템`, `S13`을 검색했을 때 위 필드 설명과 예시 외에는 나오지 않았다(번들 67개 중 `systemCode`가 있는 것은 댓글 문서 노드 하나뿐).
- 출처
  - 댓글 API 문서: https://api.flow.team/docs/api/user/comments
  - 문서 번들: https://api.flow.team/_app/immutable/nodes/23.0ad7db5e.js (진입점 https://api.flow.team/_app/immutable/entry/app.e8d4849d.js 에서 찾은 노드)
  - 참고: 이전 기록의 번들 이름(`22.49c7389d.js`, `22.61ddad61.js`)은 포털이 재배포되면서 바뀌어 지금은 404다. 노드 번호도 달라졌다.

## 2. 사람 글과 시스템 글을 공식적으로 구분하는 다른 필드

- **공식 문서에는 없다.** 댓글 응답 필드는 `commentId`, `contents`, `registerId`, `registerInttId`, `registerName`, `registerCorpName`, `registerDivisionName`, `registeredDateTime`, `editedDateTime`, `objectContentsName`, `encrypted`, `editorId`, `editorName`, `systemCode`, `repeatDateTime`, `repeatId`, `registerProfilePhoto`, `language`, `attachments`, `replies`, `replyHasNext`다. 글 종류·플래그·"시스템 여부" 필드는 없다.
- `objectContentsName`은 문서상 "작성 경로"이고 예시가 `web`이다. 실호출에서는 `null`이 많았다(`flow-alarm-probe-result.json`). 사람/시스템 구분 용도로 정의된 필드가 아니다.
- 따라서 "사람 글 = `systemCode`가 빈 문자열"은 공식 계약이 아니라 **관측으로 세운 가정**이다. 저장소의 기존 기록([14번 티켓](../issues/14-thread-change-before-post.md), [15번 티켓](../issues/15-comment-write-api-check.md))도 "관측했다"는 근거였고, 그 관측에는 첨부가 있는 댓글이 없었다.

## 3. `S13`의 의미

### 3-1. 공식 클라이언트 코드 (1차 자료, 코드 해석)

- `https://flow.team/flow-renewal/dist/js/common.min.js`의 `TagUtil.json2text`는 본문이 `{"SYS_CODE":...}` JSON일 때 코드를 표시 문구로 바꾼다. 매핑은 다음 세 개뿐이다.

  | 코드 | 클라이언트가 보여 주는 것 |
  | :- | :- |
  | `S13` | `[ICON:IMAGE] (이미지)` |
  | `S14` | `[ICON:FILE] (파일)` |
  | `S20` | 이미지와 파일 둘 다 |

  - 이 함수는 목록·알림 한 줄 요약(`db2OneString`)용이다. 첨부만 있고 글이 없는 댓글의 요약을 만드는 경로로 읽힌다.
- `detail.min.js`는 댓글을 그릴 때 `contents: TagConvert.db2HtmlStringByRemark(REMARK_CNTN, SYS_CODE)`로 본문과 `SYS_CODE`를 함께 넘기고, 같은 화면에서 `file-area`·`image-area`로 첨부를 그린다. 한 줄 요약 함수에서는 `SYS_CODE`가 비어 있지 않으면 본문 뒤에 그 코드의 표시 문구를 덧붙인다. 즉 **본문(`CNTN`)이 있는 글에도 `SYS_CODE`가 붙을 수 있게 설계돼 있다.**
- `common.min.js`에는 `S13`을 포함해 `S1`~`S2xx` 약 316개의 코드가 `system:code.S13` 같은 i18n 키로 열거돼 있다. 이 키의 번역 문구가 들어 있는 `system` 언어 파일은 공개 경로(`/flow-renewal/language-pack/ko/*.json`)에서 받을 수 없었다(`common`, `dictionary`, `main`, `alarm`, `date`, `exception`, `language`, `help` 등 열 개 남짓 파일에 `S13` 문자열이 없다). 그래서 코드별 정식 문구 표는 얻지 못했다.
- 출처: https://flow.team/flow-renewal/dist/js/common.min.js, https://flow.team/flow-renewal/dist/js/detail.min.js

### 3-2. 저장소의 실호출 기록 (관측)

- `.scratch/flow-mention-drafter/research/flow-alarm-probe-result.json` 1900행 부근에 `systemCode: "S13"`인 **사람이 쓴 댓글**이 있다. 같은 응답의 다른 값과 비교하면 다음과 같다.

  | 항목 | S13 댓글 | 시스템 댓글(예: `A00^^...`) |
  | :- | :- | :- |
  | `contents` | 사람이 쓴 문장이 있다 | 변경 내용을 설명하는 문장 |
  | `attachments` | **파일 1건**(크기 110,534바이트, 이름·확장자는 마스킹됨) | 빈 배열 |
  | `language` | `ko` | `null` |
  | `replies` | 사람이 쓴 대댓글이 달려 있다 | 없음 |

- 이 기록의 `contents`는 사용자 이름이 가려진 자리표시 문자열이라 멘션이 들어 있었는지는 이 파일만으로는 알 수 없다. 이전 세션이 말한 멘션 댓글 205760455와 이 기록이 같은 댓글이라는 증거도 이 파일에는 없다(그 ID는 이 파일과 소스에 없고, 세션 기록에만 있다).
- 위 두 자료를 합친 해석(추정): **`S13`은 "이미지 첨부가 있는 댓글" 표지이고, 사람이 글과 함께 이미지를 올리면 붙는다.** 멘션 여부와는 무관하다. 근거는 (a) 클라이언트의 `S13` → 이미지 매핑, (b) 실호출에서 `S13` 댓글이 글과 첨부 파일을 함께 가진 점이다. 멘션이 있는 글에 이미지를 붙였다면 멘션 댓글이 `S13`이 되는 것도 자연스럽다.
- 확인하지 못한 점: 그 첨부가 실제로 이미지인지(이름이 마스킹됨), `S14`·`S20`을 실제로 관측했는지, 첨부 없이 `S13`이 오는 경우가 있는지.

## 4. 코드가 아는 다른 값과의 대조 (관측, 문서에는 없음)

| 코드 | 실호출에서 본 모양 | 성격 |
| :- | :- | :- |
| `S41^^기존^^변경후` | 담당자 변경 | 시스템 기록, 작성자 = 행동한 사람 |
| `S45_2^^대기^^진행` | 업무 상태 변경 | 시스템 기록 |
| `S38^^...` | 업무 관련 기록(14번 티켓 기록) | 시스템 기록 |
| `A00^^...`, `A00_0^^...` | 제목 변경 등 | 시스템 기록 |
| `S49^^2` | 실호출에서 1건 관측 | 의미 미확인 |
| `S13`(단독, `^^` 없음) | 사람이 쓴 글 + 첨부 | **글에 붙는 표지** |

- 관측된 시스템 기록은 모두 `^^`로 구분된 인자가 붙는다(`S41^^…`, `S45_2^^…`, `A00^^…`). 첨부 표지로 읽히는 `S13`은 인자 없이 코드만 온다. 이 대비는 관측 몇 건에 근거한 것이어서 규칙으로 쓰려면 실호출 표본을 더 모아야 한다.

## 5. 구현에 주는 시사점 (이 문서의 판단이 아니라 검토 거리)

- `systemCode === ''`만 사람 글로 보는 현재 규칙은 공식 계약이 아니다. `S13`(이미지), 가능성으로는 `S14`(파일)·`S20`(둘 다)이 붙은 사람 글을 버리고, 그 결과 머리 댓글을 못 찾아 `thread-gone`이 난다.
- 코드는 "단독 코드(인자 없음)이고 `contents`가 있거나 `attachments`가 있으면 사람 글"로 구분하는 쪽이 관측과 맞지만, 이것은 추정에 의존한다. 공식 문서에 근거가 없으므로 허용 목록(`S13`/`S14`/`S20`을 사람 글로 인정)이나 `^^` 인자 유무 같은 규칙은 실호출 표본으로 한 번 더 검증한 뒤 쓰는 것이 안전하다.
- 테스트(`bundle-context.test.ts` 83행, 216행)는 `S13`을 "상태 변경"으로 가정했다. 이 조사에서는 그 가정을 뒷받침하는 자료를 찾지 못했다.

## 6. 공식 문서로 확인하지 못한 것

1. `systemCode`의 전체 값 목록과 코드별 의미(공식 문서 없음. 클라이언트 코드에서 `S13`/`S14`/`S20` 세 개만 매핑 확인).
2. `systemCode`가 비어 있지 않으면 시스템 글이라는 규칙(문서 없음).
3. 사람/시스템을 구분하는 별도 공식 필드(문서 없음).
4. `S13`이 사람 글에 붙는 모든 상황. 이미지 첨부 외 조건(멘션 등)은 확인하지 못했다.
5. `system` 언어 파일의 코드별 문구(공개 경로에서 받을 수 없었다).
6. 요청 한계: API 문서의 변경 이력(changelog)과 도움말 센터는 이번에 읽지 않았다. 도움말에 코드 표가 있는지는 미확인이다.
