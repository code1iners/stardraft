# 53: 태그 워크플로와 업데이트 서명

**Spec:** [스펙](../spec.md) 15절 "GitHub Actions"의 태그 푸시, "Release 산출물", 14절 "진위 확인"의 서명 문장과 yml 필드, "서명 키"

**What to build:** `v*` 태그를 푸시하면 CI가 버전을 검사하고, 두 OS에서 빌드하고, macOS DR과 zip 서명을 검사하고, `latest.yml`·`latest-mac.yml`에 Ed25519 서명 목록을 넣어 공개 키로 다시 검증한 뒤, 다섯 파일을 담은 초안 Release를 만든다. 저장소 주인은 `pnpm release:keygen` 한 번으로 서명 키를 준비한다.

**Blocked by:** 52

**Status:** resolved

- [x] 키 생성 스크립트: Ed25519 키 쌍을 메모리에서 만들고, 공개 키를 앱 소스의 키 목록 파일에 쓰고, 개인 키를 `gh secret set --env release`로 등록하고, 클립보드에 복사해 비밀번호 관리자에 넣었다는 확인(Enter) 뒤 클립보드를 비운다. `--rotate`는 새 공개 키를 목록에 더하고 둘째 비밀값으로 등록한다.
- [x] 서명 문장은 형식 이름, 버전, 파일 이름, sha512로 이뤄지고, 서명은 yml 안의 서명 목록 필드에 들어간다. 서명 대상은 zip과 exe. 회전 중에는 두 키로 함께 서명한다.
- [x] 태그 워크플로 검사 네 가지: 태그와 패키지 버전 일치, `.app`과 `ditto -x -k`로 푼 zip의 최상위 DR 및 `codesign --verify --deep --strict`, yml의 파일 이름·크기·sha512와 실제 파일 일치, 공개 키 목록으로 서명 재검증. 하나라도 틀리면 초안 Release를 만들지 않는다.
- [x] 마지막 Release 작업 하나가 DMG, mac zip, `latest-mac.yml`, exe, `latest.yml` 다섯 개만 올린다. `SHA256SUMS.txt`는 없다. `release` 환경 비밀값은 `v*` 태그에서만 읽힌다.
- [x] 서명·검증 코드는 Node 내장 `crypto`만 쓰고, 서명 문장 생성·검증과 yml 필드 읽기·쓰기가 테스트된다. 실제 실행 확인은 59.

## Comments

### 2026-10-22 구현과 검증 기록

**구조**

- 서명 모듈: `apps/desktop/src/core/update/update-signature.mts`
  - 태그 워크플로와 앱(54)이 이 파일 하나를 함께 쓴다. Node 내장 `crypto`·`fs`만 import한다.
  - 빌드 스크립트가 Node로 직접 불러오므로 `.mts`로 두었다. `.ts`로 두면 이 패키지에 `type`이 없어 모듈 형식 경고가 나온다. core의 Electron import 금지 lint 규칙을 `.mts`에도 걸었다.
  - 서명 문장: `stardraft-update-signature-v1`(형식 이름), 버전, 파일 이름, sha512를 줄바꿈(`\n`)으로 이은 UTF-8 문자열이다. sha512는 yml과 같은 base64다. 빈 값, 줄바꿈, 폴더가 붙은 파일 이름, 64바이트 base64가 아닌 sha512로는 문장을 만들지 않는다.
  - 서명: 서명 문장에 대한 Ed25519 서명(64바이트)의 base64.
  - 서명 목록 필드: latest*.yml의 파일 항목(`files[]`)마다 `stardraftSignatures: [서명, …]`을 둔다. 회전 중에는 서명이 두 개다.
  - 키 문자열: 공개 키는 SPKI DER의 base64(60자), 개인 키는 PKCS#8 DER의 base64(64자)다. 둘 다 한 줄이라 목록 파일, Actions 비밀값, 비밀번호 관리자에 그대로 넣는다.
  - 내보내는 것
    - `createSigningSentence`, `signUpdateFile`
    - `isSignedByAnyKey`: 서명 중 하나가 공개 키 중 하나로 검증되면 참이다(앱의 통과 기준).
    - `readSignatureList`: 필드가 없거나 비었거나 형식이 틀린 서명이 하나라도 있으면 null이다.
    - `computeFileSha512`, `generateSigningKeyPair`, `parsePublicKey`, `publicKeyOf`
- 공개 키 목록: `apps/desktop/src/core/update/update-public-keys.mts`의 `UPDATE_PUBLIC_KEYS`
  - 지금은 비어 있다. 비어 있으면 태그 워크플로는 재검증에서 멈추고 앱은 모든 업데이트를 거부한다. 키는 58 ④와 59에서 만든다.
  - 키 생성이 이 파일을 통째로 다시 쓴다. 커밋된 파일이 그 모양 그대로인지 테스트가 본다.
- 54에 넘길 메모
  - 서명 문장은 yml에 저장하지 않고 앱이 다시 만든다. 값은 `{ version: yml의 version, fileName: 받은 파일의 basename, sha512: computeFileSha512(받은 파일) }`이다.
  - 서명 목록은 `files[]` 중 `url`이 받은 파일 이름과 같은 항목에서 `readSignatureList`로 읽고, `isSignedByAnyKey(문장 값, 서명 목록, UPDATE_PUBLIC_KEYS)`로 검증한다.
  - 이렇게 하면 "sha512 일치", "서명 문장의 버전이 yml과 같음", "파일 이름 일치"가 서명 검증 하나로 함께 확인된다. "지금 버전보다 높음"만 따로 본다.
  - 파일 이름에는 yml의 `url`이 아니라 받은 파일의 basename을 넣어야 파일 이름 조건이 실제로 검사된다.
- CI 스크립트(`apps/desktop/scripts/`)
  - `release-config.mts`
    - Release 다섯 파일 이름과, 업데이트 안내 파일과 업데이트 파일의 짝을 둔다.
    - 비밀값 이름 `SIGNING_KEY_SECRETS`를 둔다. `primary`는 `UPDATE_SIGNING_KEY`, `rotation`은 `UPDATE_SIGNING_KEY_2`다.
    - 환경 이름 `release`와, package.json에서 앱 이름·버전을 읽는 함수도 둔다. `verify:mac`도 zip 이름과 package.json 값을 여기서 읽게 바꿨다.
  - `update-info.mts`(본체)와 `release-update-info.mts`(CLI): `pnpm --filter @stardraft/desktop release:check | release:sign | release:verify [폴더, 기본 release]`
    - check: 폴더에 다섯 파일만 있어야 한다. blockmap 같은 다른 파일이 있거나 빠진 파일이 있으면 멈춘다. 이어서 yml의 버전이 앱 버전과 같은지, 파일 항목이 업데이트 파일 하나뿐인지(DMG가 섞이거나 이름이 어긋나면 멈춤), size·sha512가 실제 파일과 같은지, 예전 형식의 path·sha512도 같은지 본다.
    - sign
      - 비밀값 중 값이 있는 것으로 파일 항목마다 서명을 넣는다. 빈 값은 없는 것으로 본다.
      - yml은 electron-builder·electron-updater와 같은 js-yaml 4.3.2로 읽고, electron-builder와 같은 옵션으로 다시 쓴다. 실제 빌드의 latest-mac.yml에서는 서명 목록 두 줄 말고 바뀐 것이 없었다.
      - 로그에는 비밀값마다 짝인 공개 키만 낸다. 비밀값이 키가 아니면 이름만 알리고 값은 남기지 않는다.
    - verify
      - yml을 디스크에서 다시 읽고, 실제 파일에서 다시 계산한 sha512로 서명 문장을 만든다.
      - 서명마다 앱 소스의 공개 키 목록에 있는 키 하나로 검증되어야 하고, 목록의 키마다 그 키로 만든 서명이 있어야 통과한다.
  - `update-signing-key.mts`(본체)와 `release-keygen.mts`(CLI): `pnpm release:keygen [--rotate]`(루트에서 실행)
    - 순서는 이렇다.
      1. 목록 상태를 검사한다.
      2. 키 쌍을 메모리에서 만든다.
      3. `gh secret set <이름> --env release`로 등록한다. 값은 인수가 아니라 표준 입력으로 넘긴다.
      4. `pbcopy`로 클립보드에 복사한다.
      5. 비밀번호 관리자에 넣었다는 Enter를 기다린다.
      6. 클립보드를 비운다. 중단하거나 오류가 나도 비운다.
      7. 공개 키 목록 파일을 다시 쓰고 커밋하라고 안내한다.
    - 공개 키를 마지막에 쓰므로, 중간에 멈추면 목록은 그대로다. 다시 실행하면 새 키로 처음부터 이어진다. 비밀값이 이미 바뀌었다는 것은 안내 문구로 알린다.
    - 처음 만들기는 목록이 비어 있을 때만 한다. 키가 있으면 `--rotate`를 쓰라며 멈춘다. 덮어쓰면 설치된 앱이 업데이트를 검증하지 못하기 때문이다.
    - `--rotate`는 목록에 키가 하나일 때만 한다. 새 공개 키를 목록에 더하고 개인 키를 둘째 비밀값으로 등록한다. 그 뒤 회전을 마치는 세 단계를 출력한다. 옛 공개 키를 빼고, 첫째 비밀값을 새 키로 바꾸고, 둘째 비밀값을 지우는 것이다.
    - 클립보드에 `pbcopy`를 쓰므로 macOS에서만 돈다.
- 워크플로
  - `build.yml`에 `workflow_call`을 더했다. 손으로 돌리면 전처럼 아티팩트로만 받는다.
  - `release.yml`(`v*` 태그 푸시)
    - version 작업: 태그가 `v<apps/desktop/package.json의 version>`인지 본다.
    - build 작업: `build.yml`을 부른다. macOS 작업의 `verify:mac`이 ③이다. `secrets: inherit`로 AZURE_* 저장소 비밀값이 넘어가지만, release 환경 비밀값은 넘어가지 않는다.
    - release 작업(`environment: release`, `contents: write`)
      - 의존성을 설치 스크립트 없이 설치하고, 두 아티팩트를 `apps/desktop/release`에 모은다.
      - check → sign → verify 순서로 돈다. 비밀값은 sign 단계의 환경 변수로만 넘긴다.
      - 마지막에 `gh release create <태그> apps/desktop/release/* --draft --verify-tag --title <태그> --notes ""`로 초안을 만든다.
    - 앞 단계가 하나라도 실패하면 초안 Release를 만들지 않는다.
    - download-artifact는 v8.0.2(`9000827`)로 고정했다.

**스펙에 없던 것을 정한 결정** (검토 대상)

- 서명 목록 필드의 이름과 자리
  - 파일 항목마다 `stardraftSignatures`를 둔다.
  - electron-builder가 쓰는 필드와 겹치지 않게 앱 이름을 붙였다.
  - 최상위가 아니라 파일 항목에 둔 이유: 나중에 Intel zip이 같은 latest-mac.yml에 들어와도 파일마다 서명이 붙는다.
- 서명 문장의 형식(형식 이름과 줄 구분)과 키 인코딩은 위 "구조"에 적었다.
- 비밀값 이름은 `UPDATE_SIGNING_KEY`와 `UPDATE_SIGNING_KEY_2`다.
- 재검증 기준
  - 앱의 기준("서명 목록 중 하나가 검증")보다 엄격하다. 서명한 키의 집합과 앱 소스의 공개 키 목록이 같아야 한다.
  - 공개 키를 커밋하지 않은 경우나 회전 중 비밀값 하나가 빠진 경우를 Release 전에 잡기 위해서다.
- 초안 Release의 노트는 비워 둔다.
  - 자동 생성 노트에는 PR 작성자 같은 사람 이름이 들어간다. 이 노트는 `/api/releases`를 거쳐 사이트 변경 내역에 나간다(16절 "사람 이름은 넣지 않는다").
  - 노트는 저장소 주인이 공개 전에 쓴다.
- keygen은 macOS에서만 돈다. 58과 59가 Mac에서 돈다.

**저장소 설정 몫** (58 ③에서 설정하고 59에서 확인)

- "`release` 환경 비밀값은 `v*` 태그에서만 읽힌다"를 실제로 막는 것은 `release` 환경의 배포 규칙이다. Deployment branches and tags를 `v*` 태그로만 둔다.
- 워크플로가 하는 일은 두 가지다. 이 환경을 쓰는 작업은 `v*` 태그로만 도는 release 작업 하나뿐이고, 그 작업에 `if: startsWith(github.ref, 'refs/tags/v')`를 두었다.
- 이 if는 브랜치에서 워크플로를 고치면 우회된다. 그래서 환경 규칙이 꼭 있어야 한다.

**검증**

- 자동 검사
  - 데스크톱 패키지에서 lint, typecheck, test(Vitest 1074개)가 통과했다.
  - 새 테스트는 72개다. 서명 모듈 35개, Release 검사·서명·재검증 26개, keygen 9개, 공개 키 목록 1개, import 경계 1개다.
  - 예전 형식 path 검사와 공개 키 목록 파일 모양 검사는 해당 코드를 잠깐 깨뜨려 테스트가 실패하는 것까지 확인했다.
- 워크플로: actionlint 1.7.12로 세 워크플로를 검사해 오류가 없었다. Docker로 돌렸고 shellcheck 0.11.0도 함께 돌았다.
- keygen
  - 작업 폴더 밖 임시 사본에서 가짜 `gh`·`pbcopy`를 PATH 앞에 두고 실행했다. 실제 GitHub와 클립보드는 건드리지 않았다.
  - 처음 만들기
    - gh가 `secret set UPDATE_SIGNING_KEY --env release`와 표준 입력의 64자 개인 키를 받았다.
    - 클립보드에는 같은 값이 들어갔다가 0바이트로 비워졌다.
    - 목록에 공개 키가 한 줄 들어갔다.
  - `--rotate`
    - `UPDATE_SIGNING_KEY_2`로 등록했고 목록은 두 줄이 됐다.
    - 다시 `--rotate`로 실행하거나 `--rotate` 없이 실행하면 gh를 부르지 않고 멈췄다.
  - Enter 없이 입력이 끝나거나 가상 터미널에서 Ctrl+C를 누르면, 클립보드를 비우고 목록은 그대로 두었다.
  - 루트에서 `pnpm release:keygen --help`와 모르는 인수로 실행해 인수가 전달되는 것을 확인했다.
- Release 작업 흉내
  - 이 커밋을 clone해 `pnpm install --frozen-lockfile --ignore-scripts`로 설치했다. 기본 폴더에서 `release:check`가 통과했다.
  - 실제 빌드 산출물로 check → sign(두 비밀값) → verify가 통과했다.
    - 로컬 macOS 빌드는 가짜 주인 `example-owner`로 돌렸고, 출력은 작업 폴더 밖에 냈다.
    - 그 빌드의 DMG, zip(136MB), latest-mac.yml에 가짜 Windows exe와 latest.yml을 더했다.
    - 이때 공개 키 목록은 임시 사본에서 keygen이 쓴 것이다.
  - 회전 중 둘째 비밀값만 있으면 verify가 첫째 공개 키로 만든 서명이 없다며 멈췄다.
  - 지금 저장소의 빈 목록으로는 verify가 "공개 키 목록이 비어 있습니다"로 멈췄다.
  - 버전 확인 셸 코드는 `v0.1.0`에서 통과하고 `v0.1.1`에서 멈췄다.
- 같은 빌드에서 `verify:mac`이 `.app`과 zip 모두 명시 DR로 통과했다. zip 이름을 공유 모듈에서 읽게 바꾼 뒤에 돌렸다.

**확인하지 못한 것** (실제 실행 확인은 59)

- GitHub에서 태그 워크플로를 실제로 돌리는 것. 초안 Release의 다섯 파일과 `--verify-tag`·`--notes ""` 동작도 여기에 든다. GitHub 저장소가 아직 없다.
- 실제 `pnpm release:keygen` 실행과 `gh secret set --env release`. 이번 작업에서는 실제 키를 만들지 않았다(58 ④와 59).
- windows-latest가 만든 실제 latest.yml로 하는 검사. `files[].size`가 들어간 형식은 52의 설정과 electron-builder 소스로만 확인했다.
