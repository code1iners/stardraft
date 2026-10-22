# 54: 앱 내 업데이트: 확인·다운로드·서명 검증

**Spec:** [스펙](../spec.md) 14절(출처, 확인 시점, 진위 확인, 스스로 바꿀 수 없는 위치)

**What to build:** 앱이 켜지고 1분 뒤와 4시간마다 공개 Release에서 새 버전을 확인해 묻지 않고 받는다. 받은 파일의 서명 문장을 앱에 든 공개 키로 검증해 통과할 때만 "설치 준비됨"이 된다. 틀리면 파일을 지우고 "업데이트 파일의 서명이 맞지 않아 설치하지 않았습니다. 지금 버전을 계속 씁니다."를 보인다. 앱이 스스로 바꿀 수 없는 위치면 받지 않고 [사이트에서 받기]만 보인다.

**Blocked by:** 26, 53

**Status:** resolved

- [x] electron-updater `github` provider, `autoInstallOnAppQuit = false`, 차등 다운로드 끔. 잠자기에서 깨어났을 때 마지막 확인이 4시간보다 오래됐으면 바로 확인. 설정 "일반"의 [지금 확인]. 끄는 설정은 없고 개발 모드는 업데이트를 끈다.
- [x] `update-downloaded`에서 네 조건(직접 계산한 sha512 일치, 서명 목록 중 하나가 공개 키 목록 중 하나로 검증, 서명 문장의 버전이 yml과 같고 지금보다 높음, 파일 이름 일치)을 모두 확인한다. 필드 없음·형식 오류도 실패.
- [x] 실패 시 파일 삭제, 같은 버전 자동 재다운로드 금지(더 새 버전은 받음), [다시 시도]로 재다운로드, 수동 설치 권유 없음.
- [x] 위치 확인(번들·부모 폴더 쓰기 가능, 읽기 전용 볼륨·App Translocation)을 확인할 때마다 하고, 불가하면 사유 문구("응용 프로그램 폴더로 옮긴 뒤 다시 여세요" / "이 계정은 Stardraft를 바꿀 권한이 없습니다")와 [사이트에서 받기]만. 관리자 인증 창은 띄우지 않는다.
- [x] 업데이트 상태(최신·확인 중·받는 중·설치 준비됨·서명 검증 실패·확인 실패·바꿀 수 없는 위치)가 core 상태 기계에 있고 설정 "일반"에 상태 문구가 보인다(메뉴·띠는 55).
- [x] 가짜 피드와 가짜 파일로 네 조건의 성공과 각각의 실패(sha512 변조, 서명 변조, 버전 불일치, 이름 불일치)가 테스트된다.

## Comments

### 2026-10-22 구현과 검증 기록

**구조**

- 업데이트 피드 포트: `apps/desktop/src/core/ports/update-feed.ts`의 `UpdateFeed`
  - `check()`: 지금 버전보다 새 버전의 업데이트 안내(`UpdateManifest`: 버전과 yml을 읽은 그대로의 `files[]`)를 돌려주고, 없으면 `null`이다. 확인하지 못하면 던진다.
  - `download(onProgress)`: 마지막 확인에서 찾은 버전을 끝까지 받은 결과(`DownloadOutcome`)를 돌려준다. 받지 못하면(네트워크 오류, 받다가 끊김) 던진다.
    - `{ kind: 'downloaded', update }`: 받은 파일과 그 안내.
    - `{ kind: 'sha512-mismatch' }`: 받은 파일의 sha512가 안내와 달라 업데이터가 파일을 지웠다.
  - 테스트는 가짜 피드 `core/fakes/fake-update-feed.ts`(`FakeUpdateFeed`)를 쓴다. 받으면 임시 폴더에 실제 파일을 쓴다. 받은 내용의 sha512는 일부러 안내와 견주지 않는다. 앱이 직접 다시 계산하는지 보려는 것이다.
- 앱의 피드: `apps/desktop/src/main/update-feed.ts`의 `electronUpdateFeed(autoUpdater, logger)`
  - provider는 52의 publish 설정이 설치본 `app-update.yml`에 넣는 `github`(repo `stardraft`)다.
  - 업데이터 설정은 아래와 같다.
    - `autoDownload = false`: 받을지는 core가 위치를 본 뒤 정한다.
    - `autoInstallOnAppQuit = false`, `disableDifferentialDownload = true`, `disableWebInstaller = true`, `allowDowngrade = false`, `allowPrerelease = false`.
  - `downloadUpdate()`가 푼 경로가 `update-downloaded` 이벤트의 `downloadedFile`과 같을 때 그 이벤트의 안내를 돌려준다.
  - `ERR_CHECKSUM_MISMATCH`로 거부되면 `sha512-mismatch`를 돌려주고, 다른 오류는 그대로 던진다.
  - electron-updater 로그는 같은 수준으로 진단 로그(`update.updater-log`)에 남긴다. `error` 이벤트는 로그로만 받는다(듣는 곳이 없으면 앱이 멈춤).
- core: `apps/desktop/src/core/update/in-app-update.ts`의 `InAppUpdate`
  - 상태 `UpdateStatus`
    - `idle`(이번 실행에서 아직 확인 안 함), `checking`, `up-to-date`(`checkedAt`), `check-failed`(`failedAt`), `downloading`(`version`, `percent`)
    - `ready`, `signature-failed`, `location-blocked`(`reason`)
  - 확인 시점
    - `start()`: 켜고 1분 뒤 처음 확인하고, 확인을 마칠 때마다 4시간 뒤에 다시 확인한다.
    - `checkIfDue()`: 잠자기에서 깨어났을 때 부른다. 마지막 확인이 4시간 이상 전이거나 아직 없으면 바로 확인한다. 아니면 다음 확인을 마지막 확인에서 4시간이 되는 때로 다시 예약한다. 잠든 동안 멈춘 타이머가 그만큼 늦게 오지 않게 하려는 것이다.
    - `checkNow()`: 설정 "일반"의 [지금 확인].
    - `retry()`: 서명 검증 실패 뒤의 [다시 시도]. 진행 중인 확인이 모두 끝난 뒤 실패한 버전을 다시 받는다.
    - `stop()`: 앱을 끝낼 때 부른다.
  - 확인 한 번의 흐름
    1. 새 버전이 없으면 최신 버전이다.
    2. 이미 받아 검증한 같은 버전이면 다시 받지 않는다.
    3. 서명 검증에 실패한 버전이면, [다시 시도]가 아닐 때는 받지 않고 서명 검증 실패를 그대로 보인다.
    4. 앱 위치를 본다. 바꿀 수 없으면 받지 않는다.
    5. 받는다. 업데이터가 sha512 불일치로 거부했거나 앱의 검증에 실패하면, 남은 파일을 지우고 서명 검증 실패로 둔다. 통과하면 설치 준비됨이다.
  - 안내가 있는 상태(설치 준비됨, 서명 검증 실패, 바꿀 수 없는 위치)는 정해진 확인이 "확인 중"이나 확인 실패로 덮지 않는다.
- 검증: `apps/desktop/src/core/update/update-verification.ts`의 `verifyDownloadedUpdate`
  - 53의 메모대로 서명 문장 값을 다시 만든다. `version`은 yml의 버전, `fileName`은 받은 파일의 basename, `sha512`는 받은 파일로 `computeFileSha512`를 다시 계산한 값이다.
  - `files[]` 중 `url`이 받은 파일 이름인 항목에서 `readSignatureList`로 서명 목록을 읽는다. 그다음 `isSignedByAnyKey`로 앱의 공개 키 목록(`UPDATE_PUBLIC_KEYS`)과 검증한다. 이 하나로 sha512·버전·파일 이름 조건이 함께 확인된다.
  - 지금 버전보다 높은지만 따로 본다. `MAJOR.MINOR.PATCH`만 받고, 비교는 기존 `compareVersions`를 쓴다.
  - 실패 까닭(`not-newer`, `file-entry-missing`, `signatures-missing`, `file-unreadable`, `signature-mismatch`, 그리고 업데이터의 `sha512-mismatch`)은 진단 로그 `update.signature-failed`에만 남는다. 화면에는 모두 서명 검증 실패다.
- 서명 검증에 실패한 버전: `state.db` 형식 17의 `update_signature_failure` 표(버전마다 한 줄)
  - 상태 저장소 포트에 `getSignatureFailedVersions`·`addSignatureFailedVersion`·`removeSignatureFailedVersion`을 더했다.
  - 다시 켠 뒤에도 그 버전들을 자동으로 받지 않으려고 남긴다.
  - 계정과 상관없는 기록이라 다른 계정으로 처음부터 시작해도 지우지 않는다(`TABLES_KEPT_ON_RESET`).
  - [다시 시도]로 받은 그 버전이 검증을 통과하면 뺀다.
- 위치: `apps/desktop/src/core/update/install-location.ts`의 `checkInstallLocation(bundlePath)`
  - `read-only`: 경로에 `/AppTranslocation/`이 있거나, 쓰기 확인이 `EROFS`(읽기 전용 볼륨, DMG 안)로 실패했다.
  - `no-permission`: 번들이나 부모 폴더에 쓸 권한이 없다.
  - main의 `checkAppLocation`이 `process.execPath`에서 번들 경로를 얻는다. Windows는 늘 바꿀 수 있는 위치다.
- main(`src/main/index.ts`)
  - 설치본(`app.isPackaged`)에서만 만든다.
  - `powerMonitor`의 `resume`에서 `checkIfDue()`를, 종료 준비에서 `stop()`을 부른다.
- IPC
  - 스냅숏 `update: UpdateSnapshot | null`(소스 실행은 `null`)과 변경 이벤트 `update-changed`를 둔다.
  - 명령은 `check-for-update`, `retry-update`, `open-site`다.
  - `open-site`는 `section: 'update'`만 받는다. 주소는 main의 `download-site.ts`가 정한다(`https://stardraft.squadify.app/#update`).
- 렌더러: 설정 "일반"의 업데이트 칸 `UpdateField`
  - 상태마다의 모습(문구, 위험 색, 진행 막대, 버튼)은 `update-text.ts`의 `updateFieldView` switch 하나가 정한다. 상태가 늘면 이 switch가 컴파일 오류로 알린다.
  - 버튼은 상태마다 하나다.
    - [지금 확인]: 아직 확인 안 함, 최신, 확인 실패.
    - [다시 시도]: 서명 검증 실패.
    - [사이트에서 받기]: 바꿀 수 없는 위치.
    - 확인 중·받는 중·설치 준비됨은 버튼이 없다.
  - 확인 실패의 "n시간 전"은 1분마다 새로 그린다.
  - 시각 표기는 검토 화면의 `formatMentionTime`을 `formatTime`으로 이름만 바꿔 함께 쓴다.

**스펙에 없던 것을 정한 결정** (검토 대상)

- **electron-updater가 sha512 불일치로 거부한 경우(`ERR_CHECKSUM_MISMATCH`)는 서명 검증 실패와 같게 다룬다.**
  - 이 경우는 `update-downloaded` 전에 거부된다. 그래도 받은 파일이 안내와 다르다는 뜻이라 네트워크 실패가 아니다.
  - 확인 실패로 두면 136MB 파일을 4시간마다 다시 받고, 사용자 스토리 82("틀리면 설치하지 않았다고 알려")와도 어긋난다.
  - 받다가 끊긴 것은 `net::ERR_CONTENT_LENGTH_MISMATCH` 같은 네트워크 오류로 와서 확인 실패로 남는다. 다음 확인에서 다시 받는다(실제 Electron 검증 장치에서 확인).
  - 그래서 스펙 "구현 때 확인할 것"의 두 경우("yml의 sha512를 틀리게 고친 경우", "서명 필드를 틀리게 고친 경우")가 모두 서명 실패 문구로 보인다.
- **서명 검증에 실패한 버전은 모두 기억한다.** 하나만 기억하면 이런 일이 생긴다. 0.2.0 실패 → 0.3.0 실패 → 0.3.0을 사전 릴리스로 내림 → 0.2.0을 자동으로 다시 받는다.
- **"마지막 확인"은 확인에 성공한 시각이다.** 잠자기 복귀 판정과 "최신 버전입니다 · 마지막 확인"이 이 값을 쓴다.
- **첫 확인 전 상태 `idle`**: 설정에 "아직 확인하지 않았습니다"와 [지금 확인]을 보인다(스펙 표에 없는 상태).
- **위치 확인 시점과 판정**
  - 새 버전을 찾은 확인마다 받기 전에 본다. 새 버전이 없으면 위치가 결과를 바꾸지 않기 때문이다.
  - 위치를 보지 못한 경우(예외)는 권한 없음으로 본다.
- **사이트 업데이트 섹션의 앵커는 `#update`다.** 56이 사이트를 만들 때 업데이트 섹션에 같은 id를 둔다.
- **화면 표시**
  - 설치 준비됨의 설정 문구는 "새 버전 0.2.0이 준비됐습니다"까지다. [다시 시작]·[변경 내역]은 55가 더한다.
  - 소스 실행의 업데이트 칸은 "개발 중 실행에서는 업데이트를 확인하지 않습니다."다.
  - 시각은 앱의 다른 시각 표기와 같이 "오전 10:20"으로 보인다. 스펙 표의 예는 "10:20"이다.
- **포트 목록**: 스펙 2절의 포트 목록에 없는 업데이트 피드 포트와, 주입하는 위치 확인 함수 `checkLocation`을 더했다. core가 업데이트 상태 기계를 가지려면 필요하다.

**55에 넘길 메모**

- `autoUpdater.quitAndInstall()`은 설치 준비됨일 때만 부른다.
  - macOS는 `autoInstallOnAppQuit = false`라 Squirrel.Mac이 그때 처음 받는다. electron-updater의 로컬 프록시가 검증한 파일을 그 시점에 읽어 넘긴다(6.8.10 `MacUpdater.quitAndInstall` 소스로 확인).
  - 그 전에는 Squirrel.Mac이 아무것도 받지 않는다(실제 Electron 검증 장치에서 프록시 요청 없음, ShipIt 캐시 생기지 않음).
- 상태를 더하면(다시 시작 대기, 설치 실패, 업데이트 직후 첫 실행) `updateFieldView` switch가 컴파일 오류로 알린다. 메뉴와 작은 창 띠도 표의 열마다 switch 하나씩 두면 된다.
- [변경 내역]은 `shared/ipc.ts`의 `SITE_SECTIONS`와 `main/download-site.ts`의 `SECTION_ANCHORS`에 섹션을 더해 같은 `open-site` 명령으로 연다.

**검증**

- 자동 검사: 데스크톱 패키지에서 lint, typecheck, test(Vitest 1154개)가 통과했다.
  - 새 테스트는 80개다.
    - 앱 내 업데이트 46개: 네 조건의 성공과 실패 13가지, 업데이터 sha512 불일치, 확인 시점, 실패 버전 기억과 [다시 시도], 위치, 상태 알림.
    - 위치 판정 7개, 피드 어댑터 8개, 업데이트 칸 모습 7개, 설정 칸 그리기 6개, state.db 3개, IPC 1개, 가짜 시계의 잠자기 1개, 사이트 주소 1개.
  - 위치 판정 테스트는 임시 폴더의 권한 비트와 macOS 봉인 시스템 볼륨(`/`)으로 읽기 전용과 권한 없음을 만든다.
- electron-updater 6.8.10 소스로 확인한 것
  - GitHub provider는 `releases/latest`로 최신 태그를 고르고(초안·사전 릴리스 제외), 다중 Range 요청을 끈다.
  - yml은 js-yaml로 읽은 객체를 그대로 넘겨 `files[].stardraftSignatures`가 `update-downloaded`까지 온다.
  - 캐시 파일 이름은 다운로드 주소의 basename이라 yml의 `url`과 같다.
  - `downloadUpdate()`는 `update-downloaded`를 낸 뒤 `[받은 파일]`로 풀린다.
  - 캐시 파일을 지우면 다음 다운로드에서 다시 받는다.
  - `autoInstallOnAppQuit = false`이면 macOS는 `quitAndInstall()` 전까지 Squirrel.Mac을 부르지 않고, Windows는 끌 때 설치하지 않는다.
- 패키징: 작업 폴더 밖 임시 폴더에 macOS 디렉터리 빌드를 만들었다(가짜 주인 `example-owner`).
  - app.asar에 electron-updater와 그 의존성 15개가 들어갔다. 직접 의존성 8개(builder-util-runtime, fs-extra, js-yaml, lazy-val, lodash.escaperegexp, lodash.isequal, semver, tiny-typed-emitter)와 그 아래 7개(debug, ms, sax, graceful-fs, jsonfile, universalify, argparse)다.
  - 빌드한 main 번들은 `autoUpdater`를 설치본 분기에서만 읽는다.
  - `app-update.yml`은 dmg·zip 대상에서만 생긴다. 그래서 52의 전체 빌드 기록(`provider: github`, `repo: stardraft`)으로 확인했다.
- 실제 Electron 검증 장치(작업 폴더 밖, 커밋하지 않음)
  - 구성: 실제 Electron 44.9.0 main 프로세스에서 실제 electron-updater `MacUpdater`(github provider)를 이 티켓의 어댑터·core와 묶었다.
  - 로컬 모의 GitHub 서버(releases.atom, 최신 Release API, latest-mac.yml, zip)에 물렸고, 데이터·캐시는 임시 폴더에 두었다.
  - 21개 확인이 모두 통과했다.
    - 서명 변조: 서명 검증 실패, 받은 zip 삭제, 같은 버전 자동 재다운로드 없음.
    - [다시 시도]: 다시 받아 설치 준비됨.
    - 설치 준비됨 뒤 확인: 다시 받지 않음.
    - 다시 켰을 때: 캐시 파일을 다시 검증해 설치 준비됨.
    - yml sha512 불일치: 서명 검증 실패, 다시 받지 않음.
    - 서명 목록 없음: 서명 검증 실패, 다시 켜도 받지 않음.
    - 받다가 끊김: 확인 실패, 다음 확인에서 다시 받음.
    - Squirrel.Mac 프록시 요청과 ShipIt 캐시 없음.

**확인하지 못한 것** (실제 확인은 59, Windows는 60)

- 실제 GitHub Release에서의 확인과 다운로드. GitHub 저장소와 공개 Release가 아직 없다.
- Windows(`NsisUpdater`) 실기의 확인·다운로드·검증.
- 설치본을 켠 채로 보는 것: 1분·4시간 확인, 실제 잠자기 복귀(`powerMonitor` `resume`), 설정 화면의 실제 모습. 앱 내 업데이트는 설치본에서만 돈다.
- 위치 판정의 실기 확인: DMG에서 바로 연 앱, App Translocation, macOS 표준 계정, `~/Applications`.
- 이 Mac의 `~/Library/Application Support/Stardraft/`와 `~/Library/Caches/stardraft-updater/`는 2026-10-22 구현 중 실험으로 생긴 것이다(실제 사용 데이터 아님).
  - `state.db`가 실험 당시의 옛 형식 17(`app_update` 표)이라 지금 형식 17과 다르다.
  - 59에서 설치본을 켜기 전에 두 폴더를 지운다.
