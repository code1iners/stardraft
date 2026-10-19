# 24: 설정 파일과 상태 DB

**Spec:** [스펙](../spec.md) 3절

**What to build:** 앱이 OS 표준 앱 데이터 폴더에 `settings.json`과 `state.db`를 만들고, 설정 창의 "일반" 칸에서 데이터 폴더·로그 폴더 열기와 버전을 볼 수 있다. 더 새 버전이 만든 데이터를 만나면 앱이 실행되지 않고 "이 데이터는 더 새 버전(vX)에서 만들어졌습니다. 새 버전을 다시 설치하세요"를 보인다.

**Blocked by:** 23

**Status:** ready-for-agent

- [ ] 데이터 폴더는 macOS `~/Library/Application Support/Stardraft/`, Windows `%APPDATA%\Stardraft\`이고, 개발 모드는 `Stardraft Dev` 폴더다. 위치를 바꾸는 설정과 환경 변수는 없다.
- [ ] `settings.json`은 `schemaVersion`을 갖고, 임시 파일에 쓴 뒤 이름을 바꾸는 방식으로 저장된다. 설정 저장소 포트의 실제 구현이다.
- [ ] `state.db`는 better-sqlite3 13.x(정확한 버전 고정, `.node`는 asar 밖, 번들러 외부 모듈)이고, `PRAGMA user_version` 기반 SQL 마이그레이션, WAL, `secure_delete`가 켜져 있다. ORM은 없다. 상태 저장소 포트의 실제 구현이다.
- [ ] 앱이 아는 것보다 큰 `user_version`이나 `schemaVersion`을 만나면 실행하지 않고 안내 창을 띄우며 데이터를 지우지 않는다.
- [ ] 마이그레이션 직전에 `state.db`와 `settings.json`의 사본을 버전 이름으로 남긴다(삭제 규칙은 55).
- [ ] 진단 로그가 OS 표준 로그 폴더에 크기 상한으로 회전하며, API 키와 Flow 글 본문을 남기지 않는 로거 규약이 있다.
- [ ] 설정 창 "일반" 칸에 데이터 폴더 열기, 로그 폴더 열기, 버전이 있다. 설정은 바꾸는 즉시 저장되고 "저장" 버튼이 없다.
- [ ] 마이그레이션, 다운그레이드 차단, 원자적 저장이 실제 임시 파일로 테스트된다.
