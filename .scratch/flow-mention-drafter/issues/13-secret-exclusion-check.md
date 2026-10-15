# 비밀 파일 제외 실측

Map: [Flow 멘션 답변 초안 앱](../map.md)
Type: task
Mode: AFK (에이전트가 임시 저장소와 가짜 비밀 파일을 만들고 두 CLI를 직접 실행한다. 사용자의 구독 사용량을 조금 쓴다. Codex에 로그인되어 있지 않으면 사용자에게 로그인을 부탁한다)
Status: claimed
Blocked by:

## Question

[에이전트 실행 계약 결정](07-agent-run-contract.md)에서 실행기 허용 기준을 정했다. 그 기준을 적용하려면 문서만으로 확정하지 못한 사실을 실제로 실행해 확인해야 한다. 결과에 따라 적용할 규칙은 07의 "실행기 허용 기준"에 이미 정해 두었다. 이 티켓은 사실만 확인하고 규칙을 새로 정하지 않는다.

- **Codex 권한 프로필**: `--sandbox`를 주지 않고 `--ignore-user-config`와 `-c`로 권한 프로필을 인라인으로 정의한다. 이때 아래 세 가지가 **함께** 걸리는지 확인한다. ([조사 결과](../research/cli-agent-headless.md)의 실측 항목 3)
  1. 쓰기, 명령 실행, 웹 검색(`-c web_search="disabled"`)이 막힌다.
  2. 작업 디렉터리 밖을 읽지 못한다.
  3. 비밀 파일 패턴(`.env`, `*.pem`, `id_rsa*`, `secrets/**` 등)에 맞는 파일을 읽지 못한다.
  - 권한 프로필의 `workspace_roots`에 루트를 두 개 이상 넣었을 때, 넣은 루트는 모두 읽을 수 있고 그 밖은 읽지 못하는지도 확인한다. 매핑에 저장소가 여러 개일 수 있고, 선택 실행도 작업 폴더를 여러 개 받기 때문이다.
  - 07의 규칙: 세 가지가 모두 걸리고 여러 루트도 넘길 수 있으면 Codex를 허용한다. 하나라도 안 되면 MVP에서 뺀다.
- **Claude Grep·Glob 노출**: 07의 Claude 필수 플래그 묶음으로 실행했을 때, Grep이나 Glob이 `Read` deny 처리한 파일의 내용을 결과로 드러내는지 확인한다. Glob 결과에 그 파일의 이름이 나오는지도 기록한다. (실측 항목 5)
  - 07의 규칙: 내용을 드러내면 Grep을 빼고 Read와 Glob만 쓴다.
- **Codex 필수 플래그 묶음**: 위 결과를 바탕으로 Codex의 필수 플래그 묶음을 확정한다. 07의 Claude 묶음과 같은 원칙(빼거나 바꿀 수 없는 필수 항목)을 따른다.
  - 후보: `--ignore-user-config`, `--ignore-rules`, `-c web_search="disabled"`, `--ephemeral`, `--json`, `--output-schema`, `-C`, 선택 실행에서 쓰는 `--skip-git-repo-check`, 권한 프로필
- **Codex 지침 전달 수단**: 지침을 시스템 프롬프트 자리에 넣을 수 있는 설정 키나 플래그가 있는지 확인한다. 없으면 지침을 프롬프트 맨 앞에 넣는다.

## 진행 방법

- 이 PC(macOS)에서 한다. Windows MXC 샌드박스 확인은 팀 배포 단계로 미룬다(07 참고).
- 임시 디렉터리에 git 저장소를 만들고, `.env`, `id_rsa`, `secrets/` 아래 파일에 **표지 문자열**을 넣는다. 표지 문자열은 실제 키가 아닌, 결과에서 알아보기 쉬운 가짜 값이다.
- 저장소 밖의 임시 디렉터리에도 표지 문자열을 넣은 파일을 둔다. 실제 `~/.ssh` 같은 경로는 건드리지 않는다.
- 에이전트에게 표지 문자열을 찾아서 출력하라고 지시한다. 출력이나 이벤트 스트림에 표지 문자열이 나오는지로 차단 여부를 판정한다.
- 실행한 명령, CLI 버전, 판정 결과는 `research/secret-exclusion-check.md`에 남기고 이 티켓에서 링크한다.

## Comments

### 2026-10-15 실측 진행 기록

실측 결과는 [비밀 파일 제외 실측 결과](../research/secret-exclusion-check.md)에 정리했다. 다시 돌릴 때는 [secret-exclusion-probe.py](../research/secret-exclusion-probe.py)를 쓴다. Codex 실제 모델 실행이 사용량 한도(10/20 해제)에 걸려서, 이 티켓은 아직 해결하지 않고 열어 둔다.

- **Claude Code**: 실제 모델로 실측을 끝냈다.
  - Grep과 Glob은 deny한 파일의 내용도 이름도 드러내지 않는다. 그래서 Grep을 빼지 않는다.
  - 상대 형식(`Read(**/.env)`)은 `--add-dir` 저장소에 걸리지 않아 그 저장소의 비밀 파일이 노출됐다. 절대 형식(`Read(//**/.env)`)으로 써야 한다.
  - `stream-json`에는 `--verbose`가 필수다.
- **Codex**: 실제 `codex exec`를 로컬 모의 모델로 몰아서 실측했다.
  - 권한 프로필로 비밀 파일, 저장소 밖 사용자 데이터, `/tmp`, 쓰기, 네트워크가 모두 막혔다. 여러 루트도 넘길 수 있다.
  - 막으려면 아래 항목이 필요했다.
    - `features.apps=false`: ChatGPT 앱 도구에 웹 검색, 메일 발송, 원격 쓰기가 있다.
    - `.git` deny: 압축된 git 객체를 풀어 비밀 파일을 읽을 수 있었다.
    - `/tmp` deny
    - 실제 바이너리 경로로 실행하고, 그 파일에 읽기 권한을 준다.
  - 지침은 `-c developer_instructions`로 developer 메시지에 넣는다.
- **사용자 결정**
  1. Codex는 파일을 명령으로만 읽으므로, 07의 조건 1·2를 글자 그대로는 만족하지 못한다. 기준을 **목적(부작용 차단, 사용자 데이터와 비밀 차단)으로 읽어** macOS의 Codex를 허용한다.
  2. 비밀 파일 기본 목록에 `.git/**`을 더해 두 실행기에 함께 적용한다. 더한 뒤 다시 실측해 통과했다.
  3. Codex 실제 모델 실행은 10/20 이후 다시 확인하고, 그때 이 티켓을 해결한다.
- **해결할 때 할 일**
  - `## Answer`를 쓰고 `Status: resolved`로 바꾼다.
  - [에이전트 실행 계약 결정](07-agent-run-contract.md)에 아래를 반영한다.
    - Claude 묶음: `--verbose`를 더하고, deny 규칙을 `//**/` 형식으로 쓴다.
    - 기본 목록에 `.git/**`을 더한다.
    - Codex 필수 플래그 묶음과 허용 판정을 적는다.
    - "구현 때 확인할 것" 중 이번에 확인한 세 항목(`--verbose`, `structured_output`, `--add-dir`와 `--restricted`)을 지운다.
  - 지도의 Decisions so far에 맥락 포인터를 붙인다.
  - Not yet specified에 아래 두 가지를 더한다.
    - **사용자 전역 지침이 실행에 섞이는 문제**: Codex는 `~/.codex/AGENTS.md`와 스킬 목록이 섞이고, 끌 설정이 없다. 앱 전용 `CODEX_HOME`을 둘지 정해야 한다.
    - **CLI 버전이 바뀔 때 점검 실행에 표지 검사를 넣을지**
  - npm으로 설치한 Codex의 바이너리 경로 처리는 스펙의 확인 목록으로 옮긴다.
