# Stardraft

Flow 멘션에 답할 초안을 내 PC의 CLI 에이전트로 만드는 트레이 앱이다. 받는 곳은 [stardraft.squadify.app](https://stardraft.squadify.app)이다.

| 폴더 | 내용 |
| :- | :- |
| `apps/desktop` | Electron 데스크톱 앱 |
| `apps/site` | 다운로드 사이트([README](apps/site/README.md)) |
| `scripts` | 사람이 손으로 하는 출시·점검 절차를 안내하는 마법사 |

```sh
pnpm install
pnpm dev        # 데스크톱 앱을 소스에서 실행
pnpm lint && pnpm typecheck && pnpm test
```

## 출시와 점검 마법사

사람이 직접 해야 하는 출시·점검 절차는 두 마법사에 모두 들어 있다. 스테이지마다 열 주소, 누를 것, 복사할 값, 확인 질문을 보이고, 확인한 결과를 `docs/checks/`의 기록 파일에 쌓는다. 중간에 멈추면 `--from N`으로 이어서 하고, `--only N`으로 한 스테이지만 다시 할 수 있다.

| 마법사 | 돌리는 곳 | 하는 일 |
| :- | :- | :- |
| `scripts/release-wizard.sh` | 저장소 주인의 Mac, 이 저장소 루트의 `main` | 공개 저장소 만들기, 저장소 설정, 서명 키, Vercel, 첫 Release, 설치·온보딩·업데이트 실측, 동료와 하는 확인(16개 스테이지) |
| `scripts/windows-check-wizard.sh` | 팀 배포 전 Windows PC의 Git Bash | 팀 배포 전 Windows 점검 목록 13개 항목과 Windows 스크린숏 두 곳(15개 스테이지) |

```sh
scripts/release-wizard.sh            # 처음부터
scripts/release-wizard.sh --from 12  # 12번 스테이지부터 이어서
scripts/windows-check-wizard.sh
```

- 출시 마법사에는 `git`, `gh`, `node` 24, `pnpm`이 필요하다. 첫 스테이지가 `gh` 로그인과 `workflow` 범위를 확인한다.
- 마법사가 기억하는 공개 값(저장소 주인, 버전, 스크린숏 경로)은 루트 `.env`에, 사이트를 로컬에서 띄울 값은 `apps/site/.env`에 쓴다. 둘 다 커밋하지 않는다.
- 업데이트 서명 개인 키와 Flow 키는 어디에도 저장하지 않는다. 개인 키는 `pnpm release:keygen`이 `release` 환경 비밀값과 비밀번호 관리자에 둔다.
- 기록 파일(`docs/checks/macos-release-check.md`, `docs/checks/windows-check.md`)은 회사 이름·사람 이름·실제 ID가 없는지 본 뒤 커밋한다.
