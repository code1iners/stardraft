# 53: 태그 워크플로와 업데이트 서명

**Spec:** [스펙](../spec.md) 15절 "GitHub Actions"의 태그 푸시, "Release 산출물", 14절 "진위 확인"의 서명 문장과 yml 필드, "서명 키"

**What to build:** `v*` 태그를 푸시하면 CI가 버전을 검사하고, 두 OS에서 빌드하고, macOS DR과 zip 서명을 검사하고, `latest.yml`·`latest-mac.yml`에 Ed25519 서명 목록을 넣어 공개 키로 다시 검증한 뒤, 다섯 파일을 담은 초안 Release를 만든다. 저장소 주인은 `pnpm release:keygen` 한 번으로 서명 키를 준비한다.

**Blocked by:** 52

**Status:** ready-for-agent

- [ ] 키 생성 스크립트: Ed25519 키 쌍을 메모리에서 만들고, 공개 키를 앱 소스의 키 목록 파일에 쓰고, 개인 키를 `gh secret set --env release`로 등록하고, 클립보드에 복사해 비밀번호 관리자에 넣었다는 확인(Enter) 뒤 클립보드를 비운다. `--rotate`는 새 공개 키를 목록에 더하고 둘째 비밀값으로 등록한다.
- [ ] 서명 문장은 형식 이름, 버전, 파일 이름, sha512로 이뤄지고, 서명은 yml 안의 서명 목록 필드에 들어간다. 서명 대상은 zip과 exe. 회전 중에는 두 키로 함께 서명한다.
- [ ] 태그 워크플로 검사 네 가지: 태그와 패키지 버전 일치, `.app`과 `ditto -x -k`로 푼 zip의 최상위 DR 및 `codesign --verify --deep --strict`, yml의 파일 이름·크기·sha512와 실제 파일 일치, 공개 키 목록으로 서명 재검증. 하나라도 틀리면 초안 Release를 만들지 않는다.
- [ ] 마지막 Release 작업 하나가 DMG, mac zip, `latest-mac.yml`, exe, `latest.yml` 다섯 개만 올린다. `SHA256SUMS.txt`는 없다. `release` 환경 비밀값은 `v*` 태그에서만 읽힌다.
- [ ] 서명·검증 코드는 Node 내장 `crypto`만 쓰고, 서명 문장 생성·검증과 yml 필드 읽기·쓰기가 테스트된다. 실제 실행 확인은 59.
