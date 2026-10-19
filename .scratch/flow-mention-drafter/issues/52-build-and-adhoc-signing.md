# 52: 빌드 설정과 ad-hoc 서명

**Spec:** [스펙](../spec.md) 15절(빌드 도구, macOS, Windows, publish 설정), ADR 0002

**What to build:** 로컬에서 빌드하면 macOS arm64 DMG와 zip, Windows x64 NSIS 설치 파일이 나온다. macOS 번들은 전체가 ad-hoc 서명되고 최상위 번들만 명시 DR로 다시 서명되어 `codesign -d -r-`에 `designated => identifier "app.squadify.stardraft"`가 보인다. `workflow_dispatch`로 같은 빌드를 돌려 워크플로 아티팩트로 받을 수 있다.

**Blocked by:** 23

**Status:** ready-for-agent

- [ ] electron-builder 26.17.0 정확히 고정. `mac.target: ["dmg", "zip"]`, `mac.identity: "-"`, `afterSign`에서 최상위 번들만 명시 DR 재서명(`mac.requirements`는 쓰지 않음). Fuses 적용.
- [ ] Windows: NSIS 원클릭, 사용자별 설치, 설치 위치 묻지 않음, `nsis.artifactName`은 `${productName}-Setup-${version}.${ext}`, 바로가기에 AppUserModelID, `win.azureSignOptions`와 `signExts: [".dll", ".node"]`는 `AZURE_*` 비밀값이 있을 때만.
- [ ] `publish`는 `github` provider(`repo: "stardraft"`)이고 빌드는 `--publish never`. 차등 다운로드 끔(`disableDifferentialDownload`), blockmap 안 올림.
- [ ] `workflow_dispatch` 워크플로가 macOS와 Windows 러너에서 빌드해 아티팩트로 올린다(실행 확인은 59).
- [ ] 로컬 macOS 빌드에서 `codesign --verify --deep --strict` 통과와 최상위 DR을 확인해 기록한다.
