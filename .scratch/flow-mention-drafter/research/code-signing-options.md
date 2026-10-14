# 코드 서명 선택지 조사 (Windows·macOS)

- 조사일: 2026-10-14
- 티켓: [서명 정책 재검토](../issues/10-signing-policy-review.md)
- 이어서 읽는 문서: [트레이 데스크톱 앱 프레임워크와 미서명 배포 조사](tray-app-framework.md)의 "7. 미서명 배포 경험". 거기 적힌 사실은 반복하지 않는다.
- 조사 방법
  - 1차 출처만 읽었다. Microsoft Learn·Support와 KB 릴리스 노트, Azure Retail Prices API, Apple Developer·Support 문서, Apple 오픈소스(Security), Tauri·Electron 공식 문서와 저장소 소스, CA/Browser Forum 요구사항, CA 공식 가격 페이지다.
  - 패키지 설치, 빌드, 실행은 하지 않았다. 실기로만 알 수 있는 항목은 [확인하지 못한 것](#확인하지-못한-것)에 모았다.
  - 원문은 대부분 한국어로 옮겨 적고 출처 링크를 달았다. 직접 인용은 최소로 줄였다.
- 표기: 출처가 직접 말하는 내용은 그대로 적고, 출처에서 끌어낸 판단에는 **추론**이라고 붙였다.
- 전제: 회사는 대한민국 법인이다. 사내 팀원 소수에게 다운로드 사이트로 Tauri v2 앱을 배포한다.

## 한눈에 보기

| 질문 | 답 | 확실성 |
|---|---|---|
| 1. SAC가 켜진 PC에서 서명된 새 앱이 실행되는가 | 된다. 평판이 없어도 Trusted Root Program CA 인증서로 서명돼 있으면 허용한다. Microsoft는 Artifact Signing을 SAC용 서명 방법으로 가장 권한다. OV·EV도 해당 CA 인증서면 허용 조건에 들어간다. 자체 서명은 "신뢰된 공급자" 인증서가 아니라서 막힌다 | 확정 (문서) |
| 1. SAC가 켜지는 조건 | Windows 11 22H2 이상 새 설치에서 평가 모드로 시작해 자동으로 켜지거나 꺼진다. 회사 관리 PC에서는 48시간 안에 꺼진다. 2026-01 미리 보기 업데이트에서 공개되고 2026-03부터 단계적으로 배포된 업데이트로 재설치 없이 다시 켤 수 있다 | 확정 (문서). 문서끼리 어긋나는 부분이 있다 |
| 2. 대한민국 법인이 Artifact Signing에 가입할 수 있는가 | **가입할 수 있다.** Public Trust 조직 대상국에 South Korea가 들어 있다. 개인 개발자는 미국·캐나다만 된다 | 확정 (문서) |
| 2. Artifact Signing 비용과 연동 | Basic 월 9.99달러(약 13,634원, 월 5,000서명). 유료 Azure 구독이 필요하다. 공식 GitHub Action은 Windows 러너 전용이다. Tauri는 `bundle > windows > signCommand`로 연동한다 | 확정 (문서·가격 API) |
| 3. OV 인증서 | 연 129~996달러(CA와 키 보관 방식에 따라 다르다). 2023-06부터 개인 키를 HSM에 둬야 하고, 2026-03부터 인증서 유효 기간 상한이 460일이다. PFX를 CI 비밀값에 넣는 방식은 더 이상 쓸 수 없다 | 확정 (가격은 2026-10-14 조회값) |
| 3. OV 평판이 버전을 넘어 이어지는가 | 같은 게시자 ID로 서명하면 인증서 평판이 이어질 **수 있다**(보장은 아니다). 다만 평판은 넓은 사용자층의 설치 수백 건이 쌓여야 생긴다. 사내 소수 배포에서는 서명해도 SmartScreen 경고가 남을 가능성이 높다 | 확정 (문서) + 추론 |
| 4. 자체 서명 인증서가 Keychain 재허용을 없애 주는가 | **없애 주지 못할 가능성이 높다.** DR은 업데이트 뒤에도 유지된다. 하지만 macOS는 Apple이 발급하지 않은 인증서로 서명한 앱의 Keychain 파티션 ID를 빌드마다 바뀌는 `cdhash:`로 매긴다 | 추론 (Apple 공개 소스 근거). 실기 미확인 |
| 4. 업데이트 뒤 TCC 허용 유지 | ad-hoc은 빌드마다 다시 묻는다. 자체 서명은 DR이 인증서 기준이라 유지된다 | ad-hoc 확정, 자체 서명은 문서·소스 근거 추론. 실기 미확인 |
| 4. 자체 서명 앱의 Gatekeeper 경로 | Gatekeeper가 자체 서명을 인정하지 않는다는 것만 문서로 확정된다. "그래도 열기" 경로인지 "손상됨" 경로인지는 문서로 확정할 수 없다 | 미확인 |
| 4. Electron 42 이상 알림과 자체 서명 | Electron CI가 테스트용 자체 서명 인증서로 앱을 다시 서명하고, macOS 알림 `show` 이벤트 테스트를 돌린다 | 추론 (CI 근거). 사용자 화면 표시는 미확인 |
| 4. Tauri에서 자체 서명 인증서 쓰기 | `signingIdentity` 또는 `APPLE_SIGNING_IDENTITY`에 인증서 이름을 준다. `APPLE_CERTIFICATE` 가져오기 경로는 Apple 인증서 이름만 찾기 때문에 자체 서명 인증서에서는 실패한다 | 확정 (소스) |
| 5. Apple Developer Program | 연 99달러이고 원화 금액은 가입 화면에서 표시된다. 조직 가입에는 D-U-N-S 번호, 법인격, 서명 권한, 공개 웹사이트가 필요하다. 공증하면 첫 실행 때 "인터넷에서 받은 앱인데 열겠느냐"는 확인 한 번으로 끝난다 | 확정 (문서). 원화 금액은 미확인 |

## 1. Windows 스마트 앱 컨트롤(SAC)과 서명

### 서명된 앱이 SAC를 통과하는가

- **판정 순서** ([SAC 개요](https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/overview), ms.date 2026-09-30. [SAC FAQ](https://support.microsoft.com/en-us/topic/what-is-smart-app-control-285ea03d-fa88-4d56-882e-6698afdb7003))
  - 먼저 Microsoft의 클라우드 앱 평판 서비스가 안전 여부를 예측한다. 안전하다고 보면 실행하고, 악성·PUA로 보면 막는다.
  - 예측하지 못하면 서명을 본다. 인증서가 "issued by a certificate authority (CA) within the Trusted Root Program"이면 실행을 허용한다(개요 문서).
  - 서명이 없거나 유효하지 않으면 신뢰할 수 없는 앱으로 보고 막는다(FAQ).
  - 강제 모드에서는 평판 서비스가 인정하거나 신뢰된 인증서로 서명된 앱만 실행된다(개요 문서).
- **Artifact Signing(구 Trusted Signing)**
  - "SAC 준수를 위한 앱 서명" 문서는 Artifact Signing을 가장 권하는 서명 방법이라고 적는다. RSA와 ECC 인증서 모두 지원한다. [Sign your app for Smart App Control compliance](https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/code-signing-for-smart-app-control) (ms.date 2026-09-25)
  - Artifact Signing의 Public Trust 모델이 지원하는 시나리오 목록에 "Windows 11 스마트 앱 컨트롤"이 들어 있다. 인증서는 `Microsoft Identity Verification Root Certificate Authority 2020`에서 발급된다. [Trust models](https://learn.microsoft.com/en-us/azure/artifact-signing/concept-trust-models)
  - 이 루트는 Microsoft 루트 프로그램 목록(CCADB 보고서)에 `Included` 상태이고, 용도는 Code Signing과 Time Stamping이다(2026-10-14 조회). [CCADB Microsoft 포함 CA 보고서](https://ccadb.my.salesforce-sites.com/microsoft/IncludedCACertificateReportForMSFT)
  - **주의할 변경**: 인증서 관리 문서(ms.date 2026-09-30)에 따르면 Artifact Signing의 코드 서명 발급 CA들은 CCADB에서 빠질 예정이다. Microsoft는 이 CA들을 더 이상 Trusted Root Program에 넣지 않지만 Windows Platform Trust List에는 남겨 두고, Windows는 계속 신뢰한다. [Certificate management](https://learn.microsoft.com/en-us/azure/artifact-signing/concept-certificate-management)
    - 추론: SAC 문서의 "Trusted Root Program" 표현과 어긋나 보이지만, 같은 달에 고친 SAC 서명 문서가 여전히 Artifact Signing을 권한다. 그래서 Windows에서는 SAC를 통과한다고 본다. Windows 밖의 검증 도구에서는 신뢰가 약해질 수 있지만 이 앱과는 무관하다.
- **OV·EV 인증서**: Trusted Root Program에 속한 CA가 발급했다면 위 허용 조건에 들어간다. DigiCert, Sectigo, SSL.com, GlobalSign은 모두 Code Signing 용도 루트가 Microsoft 포함 목록에 있다(2026-10-14, 위 CCADB 보고서).
- **자체 서명 인증서**: 어떤 인증서로든 서명할 수는 있지만 SAC는 신뢰된 공급자가 발급한 인증서만 고려한다([SAC 준수 서명 문서](https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/code-signing-for-smart-app-control)). 따라서 평판이 없는 자체 서명 앱은 미서명과 같이 막힌다.
- **SAC는 실행 시점에 불러오는 모든 바이너리를 검사한다** ([Test your app's signature](https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/test-your-app-with-smart-app-control), ms.date 2025-10-28)
  - 설치·제거 프로그램, 앱의 모든 기능, 다른 앱이 불러오는 바이너리까지 시험하라고 안내한다.
  - 개발자용 감사 정책 `SmartAppControlAuditNoISG.bin`을 쓰면 평판(ISG) 없이 서명 조건만으로 판정한다. SAC가 꺼져 있어도 적용할 수 있다.
  - 막힌(또는 막혔을) 파일은 `Microsoft-Windows-CodeIntegrity/Operational` 로그에 남는다. 평가 모드는 이벤트 3076, 강제 모드는 3077이다.
- **Tauri NSIS 설치 파일**
  - NSIS는 설치할 때 플러그인 DLL을 임시 폴더에 풀어 쓴다.
  - Tauri 번들러는 서명이 설정돼 있으면 앱 exe, DLL, NSIS 플러그인, 설치 파일을 모두 서명한다. [PR #11676 "sign DLLs"](https://github.com/tauri-apps/tauri/pull/11676)(2025-04-13 병합), [PR #14627 "plugins not signed"](https://github.com/tauri-apps/tauri/pull/14627)(2025-12-08 병합)
  - 추론: 빌드가 끝난 뒤 설치 파일만 따로 서명하면 그 안에 든 앱 exe와 플러그인 DLL이 미서명으로 남는다. 그러면 SAC 강제 모드에서 설치나 실행이 막힌다. 그래서 서명은 Tauri 빌드 안에서 `signCommand`로 걸어야 한다.

### SAC가 기본으로 켜지는 조건

- **대상**: Windows 11 22H2부터 들어갔다. [App Control for Business](https://learn.microsoft.com/en-us/windows/security/application-security/application-control/app-control-for-business/appcontrol) (ms.date 2026-08-18) Windows 10에는 없다. [App & Browser Control](https://support.microsoft.com/en-us/windows/app-browser-control-in-the-windows-security-app-8f68fb65-ebb4-3cfb-4bd7-ef0f376f3dc3)
- **평가 모드** ([App & Browser Control](https://support.microsoft.com/en-us/windows/app-browser-control-in-the-windows-security-app-8f68fb65-ebb4-3cfb-4bd7-ef0f376f3dc3))
  - 새 설치에서 평가 모드로 시작한다. 이 기간에는 아무것도 막지 않는다.
  - Windows가 이 PC를 적합하다고 판단하면 자동으로 켜고(On), 아니면 끈다(Off).
  - 평가가 끝나거나 사용자가 직접 켜고 끄면 평가 모드로 돌아갈 수 없다. 돌아가려면 Windows를 다시 설치하거나 초기화해야 한다.
  - 강제 모드로 들어가면 토스트 알림으로 알려 준다. [SAC 개요](https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/overview)
- **평가 모드에서 자동으로 꺼지는 경우**
  - 회사 사용자나 개발자처럼 SAC와 맞지 않는 일을 자주 하는 사용자로 판단되면 자동으로 끈다. [SAC 개요](https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/overview)
  - FAQ가 드는 꺼짐 이유는 네 가지다. [SAC FAQ](https://support.microsoft.com/en-us/topic/what-is-smart-app-control-285ea03d-fa88-4d56-882e-6698afdb7003)
    - 기업 관리 장치이거나 개발자 모드가 켜져 있다.
    - 사용자가 직접 껐다.
    - S 모드다.
    - 선택적 진단 데이터 전송이 꺼져 있다. 이 경우 켜려면 PC를 초기화하거나 다시 설치하면서 진단 데이터 전송을 골라야 한다.
- **회사 관리 PC** ([App Control for Business](https://learn.microsoft.com/en-us/windows/security/application-security/application-control/app-control-for-business/appcontrol))
  - 평가 모드로 시작하지만, 사용자가 먼저 켜지 않으면 기업 관리 장치에서는 48시간 안에 꺼진다.
  - 관리자는 레지스트리 값으로 조직 전체에서 미리 끌 수 있다. 값은 `HKLM\SYSTEM\CurrentControlSet\Control\CI\Policy`의 `VerifiedAndReputablePolicyState`(0 끔, 1 강제, 2 평가)이고, 바꾼 뒤 `CiTool.exe -r`을 실행한다.
  - "기업 관리 장치"를 Intune 등록으로 판정하는지 도메인 가입으로 판정하는지는 문서에 없다.
  - 추론: 회사 PC에서는 SAC보다 IT가 배포한 App Control for Business 정책이나 SmartScreen 정책이 실제 동작을 정한다. SmartScreen 문서도 기업 정책이 "그래도 실행"을 막을 수 있다고 적는다([앞 조사](tray-app-framework.md#windows-smartscreen과-스마트-앱-컨트롤)).
- **최근 변경: 재설치 없이 켜고 끄기**
  - [KB5074105](https://support.microsoft.com/help/5074105)(2026-01-29, 미리 보기, OS 빌드 26200.7705·26100.7705): SAC를 클린 설치 없이 켜고 끌 수 있게 됐다고 처음 공개했다.
  - [KB5079391](https://support.microsoft.com/help/5079391)(2026-03-26, 미리 보기, 26200.8116·26100.8116): 1월에 공개한 이 기능이 단계적 배포(gradual rollout)로 나가기 시작했다고 적었다. 이 업데이트는 설치 오류(0x80073712) 때문에 2026-03-27에 배포가 잠시 멈췄다.
  - FAQ도 최근 업데이트로 클린 설치 없이 다시 켤 수 있다고 적는다. [SAC FAQ](https://support.microsoft.com/en-us/topic/what-is-smart-app-control-285ea03d-fa88-4d56-882e-6698afdb7003)
  - **문서끼리 어긋난다.** App & Browser Control 지원 문서는 아직 "새 설치에서만 쓸 수 있다"고 적는다. 개발자 시험 문서(ms.date 2025-10-28)도 켜기·끄기는 한 방향이라고 적는다. 추론: 날짜가 더 늦은 KB 릴리스 노트와 FAQ가 현재 동작이다.
  - 추론: 이전에 SAC를 꺼 둔 사용자도 다시 켤 수 있게 됐다. 앞으로 SAC가 켜진 PC를 만날 가능성이 커진다.

## 2. Artifact Signing (구 Trusted Signing)

### 가입 가능 국가

- **조직**: Public Trust 인증서는 미국, 캐나다, EU, 영국, 호주, 뉴질랜드, 일본, **한국(South Korea)**, 싱가포르, 스위스, 노르웨이, 이스라엘의 조직이 쓸 수 있다. [Quickstart](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart) (ms.date 2026-05-21, 갱신 2026-10-08)
- **개인 개발자**: 미국이나 캐나다에 있어야 한다(같은 문서).
- **Private Trust**는 국가 제한이 없다. 하지만 어떤 루트 프로그램에도 기본 신뢰되지 않으므로 SAC 통과에는 쓸 수 없다. [Trust models](https://learn.microsoft.com/en-us/azure/artifact-signing/concept-trust-models)
- 결론: **대한민국 법인은 조직 자격으로 Public Trust에 가입할 수 있다.** 직원 개인 명의로는 가입할 수 없다.
- Azure 지역 `Korea Central`에서도 쓸 수 있다. 엔드포인트는 `https://krc.codesigning.azure.net`이다. [Signing integrations](https://learn.microsoft.com/en-us/azure/artifact-signing/how-to-signing-integrations)

### 요금

- **요금제** ([Change the account SKU](https://learn.microsoft.com/en-us/azure/artifact-signing/how-to-change-sku))

  | 항목 | Basic | Premium |
  |---|---|---|
  | 월 기본료 | 9.99달러 | 99.99달러 |
  | 월 포함 서명 수 | 5,000 | 100,000 |
  | 초과분 | 서명당 0.005달러 | 서명당 0.005달러 |
  | 인증서 프로필 | 유형별 1개 | 유형별 10개 |

- **원화 가격**: Azure Retail Prices API로 조회했다(2026-10-14). Basic은 월 13,633.85원, Premium은 월 136,461.35원이다. API에는 아직 옛 이름 `Trusted Signing`으로 올라 있다. 세금 포함 여부는 확인하지 않았다. [Retail Prices API](https://prices.azure.com/api/retail/prices?currencyCode=KRW&$filter=serviceName%20eq%20%27Trusted%20Signing%27)
- 일할 계산하지 않는다. 계정을 만든 달에는 언제 쓰기 시작했든 선택한 요금제 금액이 전부 청구된다. [FAQ](https://learn.microsoft.com/en-us/azure/artifact-signing/faq)
- 무료, 체험, 후원 Azure 구독으로는 만들 수 없다. 종량제나 기업 계약 같은 유료 구독이 필요하다(같은 FAQ).
- **EV 인증서는 발급하지 않고 계획도 없다**(같은 FAQ).
- **인증서 특성** ([Certificate management](https://learn.microsoft.com/en-us/azure/artifact-signing/concept-certificate-management))
  - 매일 새로 발급되고 72시간만 유효하다. 그래서 타임스탬프가 필수다. Microsoft TSA는 `http://timestamp.acs.microsoft.com`이다.
  - 개인 키는 서비스 HSM 안에만 있고 내보낼 수 없다.
  - 인증서 프로필마다 고정된 EKU(`1.3.6.1.4.1.311.97.*`)가 붙는다. 프로필을 지우고 새로 만들면 EKU가 바뀐다.

### 신원 확인 요건 (조직)

- 입력 항목 ([Quickstart](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart), "Identity Validation - Organization")
  - 법인명: 인증서를 받을 법적 사업체
  - 웹사이트
  - 주 이메일: 그 법인이 소유한 도메인의 주소여야 한다. 확인 링크가 이 주소로 가고 7일 뒤 만료된다. 외부 발신 메일의 링크를 받을 수 있어야 한다.
  - 보조 이메일: 주 이메일과 다른 주소이고 도메인은 같아야 한다.
  - Business Identifier(사업자 식별 번호)
  - 사업장 주소
  - 대표자 이름: 법인을 대표해 개인 신원 확인을 할 사람이다.
- 대표자는 개인 신원 확인을 거친다. 제3자 확인 업체(AU10TIX) 화면에서 정부 발급 신분증을 제출하고, Microsoft Authenticator에 Verified ID를 받아 제출한다(같은 문서).
- 처리 기간은 영업일 1~20일이고, 서류를 더 요구하면 더 걸린다. 추가 서류는 최근 12개월 안에 발급된 것이어야 하고, 업로드 기회는 세 번이다(같은 문서).
- 인증서 CN과 O는 바꿀 수 없고, 검증된 법인명이 그대로 들어간다. [FAQ](https://learn.microsoft.com/en-us/azure/artifact-signing/faq)
- 신원 확인에는 만료가 있다. 만료 60일 전부터 갱신할 수 있고, 갱신 때 처음부터 다시 심사한다(영업일 1~20일). 갱신하지 않으면 인증서 발급이 멈춘다. [Renew identity validation](https://learn.microsoft.com/en-us/azure/artifact-signing/how-to-renew-identity-validation)
- **사업 기간 요건**: 현재 Quickstart와 FAQ에는 사업 기간(예: 설립 후 N년)에 관한 문구가 없다(2026-10-14 확인).
- 추론: 한국 법인은 Business Identifier에 사업자등록번호를 넣게 될 가능성이 높다. 한국어 법인명이 인증서와 SmartScreen 게시자 이름에 어떻게 표기되는지는 확인하지 못했다.

### GitHub Actions 연동

- **공식 Action**: [`azure/artifact-signing-action`](https://github.com/Azure/artifact-signing-action), 최신 `v2.0.0`(2026-05-14)
  - Windows 러너에서만 돈다(`windows-2025`, `windows-2022`). Windows Arm 러너는 지원하지 않는다.
  - `azure/login`으로 OIDC 인증을 하라고 권한다.
  - 주요 입력은 `endpoint`, `signing-account-name`, `certificate-profile-name`, `files` 또는 `files-folder`, `file-digest`, `timestamp-rfc3161`이다.
- **SignTool 직접 사용** ([Signing integrations](https://learn.microsoft.com/en-us/azure/artifact-signing/how-to-signing-integrations))
  - SignTool 10.0.2261.755 이상, .NET 8 런타임, Artifact Signing dlib 패키지가 필요하다. dlib는 `winget install -e --id Microsoft.Azure.ArtifactSigningClientTools`나 NuGet `Microsoft.ArtifactSigning.Client`로 설치한다.
  - `metadata.json`에 `Endpoint`, `CodeSigningAccountName`, `CertificateProfileName`을 적는다.
  - 문서의 서명 명령은 아래와 같다.

    ```
    signtool.exe sign /v /debug /fd SHA256 /tr "http://timestamp.acs.microsoft.com" /td SHA256 /dlib "<dlib 경로>\x64\Azure.CodeSigning.Dlib.dll" /dmdf "<경로>\metadata.json" <파일>
    ```

- 서명하는 주체에는 `Artifact Signing Certificate Profile Signer` 역할이 있어야 한다. [FAQ](https://learn.microsoft.com/en-us/azure/artifact-signing/faq)

### Tauri v2 연동

- Tauri Windows 서명 문서에 "Azure Artifact Signing" 절이 있다. [Windows Code Signing](https://v2.tauri.app/distribute/sign/windows/) (원본 마지막 수정 2026-09-11, [소스](https://github.com/tauri-apps/tauri-docs/blob/v2/src/content/docs/distribute/Sign/windows.mdx))
  - 커뮤니티 도구 [`artifact-signing-cli`](https://github.com/Levminer/artifact-signing-cli)를 `cargo install`로 설치한다.
  - 환경 변수 `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID`를 GitHub 비밀값으로 넣는다.
  - `tauri.conf.json`에 아래처럼 `signCommand`를 준다. `-e`는 엔드포인트, `-a`는 계정, `-c`는 인증서 프로필, `-d`는 설명이다.

    ```json
    { "bundle": { "windows": {
      "signCommand": "artifact-signing-cli -e https://krc.codesigning.azure.net -a <계정> -c <프로필> -d <앱 이름> %1"
    } } }
    ```

  - 선행 조건은 .NET 8, Azure CLI, SignTool(Windows 11 SDK 10.0.26100.0 이상 권장)이다.
- `signCommand`는 `%1` 자리에 바이너리 경로를 넣어 호출한다. 기본값은 `signtool.exe`라서 Windows에서만 동작한다. macOS나 Linux에서 교차 빌드할 때는 반드시 사용자 서명 명령을 줘야 한다. [config.rs](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-utils/src/config.rs), [Windows Code Signing](https://v2.tauri.app/distribute/sign/windows/)
- 추론
  - `signCommand`에 위 SignTool+dlib 명령을 직접 넣어도 된다. 그러면 커뮤니티 CLI 없이, `azure/login` OIDC 세션으로 서명할 수 있다. dlib는 `DefaultAzureCredential`을 쓰므로 Azure CLI 자격 증명을 집어 들 것으로 본다(미검증).
  - 공식 Action을 빌드 뒤 단계로 붙이면 설치 파일 안의 exe를 서명하지 못한다. Tauri 빌드 중에 서명해야 한다(1절 참고).

## 3. 한국 법인이 쓸 수 있는 Windows 서명 대안 (OV 인증서)

### 대표 CA의 OV 코드 서명 가격 (2026-10-14 공식 페이지 조회, 세금 별도)

| CA | OV 연 가격 | 키 보관과 클라우드 서명 비용 | 출처 |
|---|---|---|---|
| SSL.com | 1년 129달러. 2년이면 연 116.10달러, 3년이면 연 109.65달러, 5년이면 연 96.75달러 | eSigner 클라우드 서명 구독: Tier 1 월 15달러(월 240서명, 자격 증명 1개), Tier 2 월 63.75달러(1,200서명). 연 단위로 내면 25% 넘게 싸다. 새 인증서는 30일 무료다. YubiKey 토큰은 OV 페이지에 379달러, 서명 서비스 페이지에 249달러로 서로 다르게 적혀 있다. 자체 클라우드 HSM은 키 증명 수수료가 500달러부터다(Azure Dedicated HSM 500달러, AWS CloudHSM 1,500달러) | [OV Code Signing](https://www.ssl.com/products/software-integrity/code-signing/ov/), [Signing Service](https://www.ssl.com/products/software-integrity/signing-service/) |
| DigiCert | 12개월 자동 갱신 구독. 직접 보관(자체 토큰이나 HSM) 696달러, DigiCert 토큰 840달러, KeyLocker 클라우드 996달러. EV는 각각 972, 1,116, 1,272달러 | KeyLocker는 인증서당 연 1,000서명 한도가 있고, 1,000개 단위로 더 살 수 있다 | [DigiCert code signing](https://www.digicert.com/signing/code-signing-certificates)(페이지 내 SKU 데이터), [KeyLocker licensing](https://docs.digicert.com/en/digicert-keylocker/overview/licensing.html) |
| Sectigo | 5년 상품을 고르면 연 536.25달러부터다. 기간이 짧을수록, EV일수록 비싸다. 상세 가격표는 로그인해야 보인다 | 여러 해 상품도 해마다 새 인증서와 새 FIPS 토큰을 보낸다 | [Sectigo Code Signing](https://www.sectigo.com/ssl-certificates-tls/code-signing) |
| GlobalSign | 가격표가 스크립트로 그려져서 확인하지 못했다 | - | [GlobalSign shop](https://shop.globalsign.com/en/code-signing) |

- 추론(연 비용 비교): Artifact Signing Basic은 연 약 120달러다. SSL.com OV에 eSigner Tier 1을 월 단위로 붙이면 연 약 309달러다. DigiCert OV+KeyLocker는 연 996달러다.

### 개인 키 HSM 보관 의무와 유효 기간

- **HSM 의무** ([CA/B Forum Code Signing Baseline Requirements](https://cabforum.org/working-groups/code-signing/requirements/) v3.11.0, 2026-06-16, 6.2.7.4)
  - 2023-06-01부터 코드 서명 인증서의 개인 키는 FIPS 140-2 Level 2 또는 Common Criteria EAL 4+ 이상 하드웨어 모듈에서 만들고 보관해야 한다.
  - 허용 방식은 세 가지다.
    - 직접 가진 HSM이나 토큰
    - 모든 접근과 작업을 기록하는 클라우드 HSM
    - 요구사항을 충족하는 서명 서비스
  - CA는 키 증명(attestation), CA가 보낸 토큰, 감사 보고서 같은 방법으로 이를 확인해야 한다(6.2.7.4.2).
- **유효 기간**: 2026-03-01 이후 발급분은 최대 460일이다(6.3.2). Sectigo는 2026-02-23부터 최대 459일로 발급한다고 적는다.
- RSA 키는 3072비트 이상이어야 한다(같은 문서).
- **Tauri 문서의 OV 절차는 낡았다**: `.pfx`를 가져오는 Tauri의 OV 안내는 2023-06-01 이전에 산 인증서에만 해당한다고 문서 스스로 경고한다. [Windows Code Signing](https://v2.tauri.app/distribute/sign/windows/)
- 결론: 지금 산 OV 인증서는 PFX를 GitHub 비밀값에 넣어 CI에서 쓸 수 없다. CI에서 쓰려면 아래 클라우드 서명이 필요하다.

### CI에서 쓸 수 있는 클라우드 서명

- **Azure Key Vault (Premium, HSM 보호 키)**
  - 새 키는 FIPS 140-3 Level 3 HSM(HSM Platform 2)이 보호한다. [About keys](https://learn.microsoft.com/en-us/azure/key-vault/keys/about-keys)
  - RSA 3072 이상과 ECC는 "advanced key"로 분류된다. [Key Vault pricing](https://azure.microsoft.com/en-us/pricing/details/key-vault/)
  - Retail Prices API(Korea Central) 기준으로 HSM 보호 advanced key는 처음 250개까지 키당 5달러(단위 기간은 가격 페이지 기준 월)다. advanced key 작업은 1만 건당 0.15달러, 인증서 갱신 요청은 건당 3달러다. [Retail Prices API](https://prices.azure.com/api/retail/prices?$filter=serviceName%20eq%20%27Key%20Vault%27%20and%20armRegionName%20eq%20%27koreacentral%27)
  - Tauri 문서는 `relic`과 `signCommand`로 Key Vault 인증서를 쓰는 방법을 안내한다. [Windows Code Signing](https://v2.tauri.app/distribute/sign/windows/)
  - Key Vault 키에 대한 증명을 받아 OV를 발급해 주는 CA와 그 비용은 확인하지 못했다.
- **DigiCert KeyLocker**: KSP, PKCS#11, Software Trust Manager GitHub Action으로 GitHub Actions에 붙이는 문서가 있다. [GitHub KSP 연동](https://docs.digicert.com/en/digicert-keylocker/ci-cd-integrations/script-integrations/github-integration-ksp.html) 추가 비용은 직접 보관 대비 연 300달러이고 서명 한도가 있다(위 표).
- **SSL.com eSigner**: 키를 FIPS 140-2 Level 3 클라우드 HSM에 두고, REST API로 GitHub Actions, Jenkins, Azure DevOps, GitLab CI에서 서명한다. [SSL.com Code Signing](https://www.ssl.com/certificates/code-signing/) 비용은 위 표의 eSigner 구독이다.
- 추론: 서명 횟수는 빌드 한 번에 exe, NSIS 플러그인 DLL 몇 개, 설치 파일 정도다. 어느 방식이든 가장 낮은 등급으로 충분하다.

### OV 서명 앱의 SmartScreen 평판은 버전을 넘어 이어지는가

- **이어질 수 있지만 보장은 아니다** ([SmartScreen reputation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation), ms.date 2026-05-04)
  - SmartScreen은 파일 해시 평판과 게시자 인증서 평판을 함께 본다.
  - 신뢰된 인증서로 서명하면 인증서 평판이 쌓일 수 있다. 그러면 같은 인증서로 서명한 새 파일에서 경고를 피할 수도 있다.
  - 이전 버전 평판은 같은 게시자 ID로 서명했을 때만 넘어간다. 서명 인증서를 바꾸면 게시자 신호가 달라지니 같은 서명 ID를 계속 쓰라고 권한다.
  - [배포 기능 현황](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/distribution-feature-status)(ms.date 2026-08-24)도 같은 내용이다. 같은 서명 ID면 게시자 평판이 이어질 수 있고, OV든 EV든 즉시 경고를 없애 주지는 않는다.
- **평판이 쌓이는 속도**: 정해진 기준은 없다. 넓은 사용자층에서 깨끗한 설치 수백 건과 몇 주가 걸릴 수 있다(SmartScreen 문서).
- 기업 IT 관리자는 내부 배포 파일을 Microsoft Security Intelligence 포털에 제출해 신뢰를 앞당길 수 있다(같은 문서).
- 추론: 사내 소수 배포는 평판이 거의 쌓이지 않는다. OV든 Artifact Signing이든 첫 실행 SmartScreen 경고는 계속 볼 가능성이 높다. 다만 경고에 게시자 이름이 보인다. 이 앱에서 서명이 주는 확실한 이득은 SAC 통과다.
- 미확인: 460일 상한 때문에 OV 인증서를 해마다 다시 받을 때 평판이 이어지는지 문서에 없다. Artifact Signing은 인증서가 매일 바뀌는데, 평판을 무엇에 묶는지도 문서에 없다. 문서는 시간이 지나며 쌓인다고만 적는다.

## 4. macOS: ad-hoc 서명 대 자체 서명 인증서

### designated requirement(DR)

- **DR의 역할** ([TN3127: Inside Code Signing: Requirements](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements), 2024-04-02 개정)
  - DR은 코드가 "다시 보면 이렇게 나를 알아보라"고 스스로 밝히는 규칙이다.
  - macOS는 마이크 같은 개인정보 보호 자원을 허용할 때 앱의 DR을 기록한다. 이후 새 버전이 그 DR을 만족하면 같은 앱으로 본다.
  - **ad-hoc 서명 코드도 DR이 있지만 그 특정 버전에 묶인다.** 그래서 macOS가 버전을 넘어 같은 앱으로 추적하지 못하고, 수정해서 다시 실행하면 다시 묻는다.
- **소스로 본 기본 DR** (Apple 공개 소스 [Security](https://github.com/apple-oss-distributions/Security))
  - ad-hoc 서명이면 `SecStaticCode::defaultDesignatedRequirement`가 모든 아키텍처의 cdhash를 나열한 요구사항을 만든다. [StaticCode.cpp](https://github.com/apple-oss-distributions/Security/blob/main/OSX/libsecurity_codesigning/lib/StaticCode.cpp)
    - 그래서 빌드마다 DR이 바뀐다.
  - Apple이 발급하지 않은 인증서로 서명하면 `DRMaker::nonAppleAnchor`가 DR을 만든다. [drmaker.cpp](https://github.com/apple-oss-distributions/Security/blob/main/OSX/libsecurity_codesigning/lib/drmaker.cpp)
    - DR은 "코드 서명 식별자 + 인증서 SHA-1 해시"다.
    - 인증서와 식별자(번들 ID)가 같으면 업데이트해도 DR이 같다.
- **Code Signing Guide** ([About Code Signing](https://developer.apple.com/library/archive/documentation/Security/Conceptual/CodeSigningGuide/AboutCS/AboutCS.html), 2016-09-13 갱신, 보관 문서)
  - Keychain과 자녀 보호 기능은 서명자가 누구인지보다 서명이 유효하고 DR이 안정적인지만 본다고 설명한다.
  - 이 용도에는 자체 서명 ID도 기본으로 동작한다고 적는다. 다만 Gatekeeper에는 통하지 않으니 배포용으로는 권하지 않는다.
- **사용자 Mac에 인증서를 설치할 필요는 없다**: 요구사항에 `anchor trusted`를 넣지 않으면 시스템은 신뢰 설정 DB를 보지 않는다. [Code Signing Tasks](https://developer.apple.com/library/archive/documentation/Security/Conceptual/CodeSigningGuide/Procedures/Procedures.html)

### Keychain 항목 ACL("항상 허용")은 업데이트 뒤에도 유지되는가

- **어느 Keychain을 쓰게 되는가** ([TN3137: On Mac keychain APIs and implementations](https://developer.apple.com/documentation/technotes/tn3137-on-mac-keychains), 2026-09-24 개정)
  - macOS에는 파일 기반 Keychain과 data protection Keychain이 있다.
  - data protection Keychain의 접근 그룹은 서명 entitlement에서 오고, 그 entitlement는 프로비저닝 프로필로 승인돼야 한다.
  - 추론: Apple 개발자 팀이 없는 ad-hoc·자체 서명 앱은 파일 기반 Keychain(ACL 방식)을 쓸 수밖에 없다.
  - Rust `keyring` 4.2.0의 기본 기능 `v1`도 macOS에서 파일 기반 `keychain` 저장소를 쓴다. [Cargo.toml](https://github.com/open-source-cooperative/keyring-rs/blob/main/Cargo.toml)
    - `protected`(data protection) 저장소는 프로비저닝 프로필로 서명된 앱이 필요하다고 적혀 있다. [apple-native-keyring-store](https://github.com/open-source-cooperative/apple-native-keyring-store)
- **ACL의 동작**: 앱이 신뢰 목록에 없으면 사용자에게 묻는다. "항상 허용"을 고르면 그 앱이 신뢰 목록에 추가된다. [Access Control Lists](https://developer.apple.com/documentation/security/access-control-lists) Code Signing Guide는 Keychain이 항목을 만든 앱을 DR로 추적한다고 적는다(위 About Code Signing의 표).
- **그런데 파티션 목록이 따로 있다** (macOS 10.11부터. [SecAccess.h](https://github.com/apple-oss-distributions/Security/blob/main/OSX/libsecurity_keychain/lib/SecAccess.h)의 `kSecACLAuthorizationPartitionID`)
  - securityd는 접근하는 앱마다 파티션 ID를 매긴다. [clientid.cpp](https://github.com/apple-oss-distributions/Security/blob/main/securityd/src/clientid.cpp) `partitionIdForProcess`
    - Apple 코드는 `apple:`
    - Mac App Store·TestFlight·Developer ID·Apple 개발 인증서로 서명한 코드는 `teamid:<팀 ID>`
    - 그 밖의 서명된 코드는 `cdhash:<이 빌드의 cdhash>`
    - 서명 없는 코드는 `unsigned:`
  - 항목의 파티션 목록에 앱의 파티션 ID가 없으면 사용자에게 묻는다. 거부되면 접근이 막힌다. [acls.cpp](https://github.com/apple-oss-distributions/Security/blob/main/securityd/src/acls.cpp) `validatePartition`, `extendPartition`
- **추론: 자체 서명 인증서는 Keychain 재허용을 없애 주지 못한다**
  - 자체 서명 앱은 Apple 발급 인증서가 아니라서 파티션 ID가 `cdhash:`다. 업데이트하면 cdhash가 바뀐다.
  - DR 덕분에 ACL의 신뢰 앱 검사는 통과하더라도, 파티션 검사에서 다시 묻게 된다.
  - ad-hoc도 DR과 파티션이 모두 바뀌므로 다시 묻는다. 사용자가 보는 결과는 둘 다 "업데이트 뒤 한 번 더 묻는다"일 것이다.
  - 2016년 Code Signing Guide의 "자체 서명도 Keychain에 통한다"는 설명은 파티션 목록 도입 무렵에 쓰여, 이 동작을 반영하지 않은 것으로 보인다.
  - Electron 문서가 "유효하고 일관된 서명"이 없으면 업데이트마다 Keychain이 다시 묻는다고 적는 것도 이 동작과 맞다([앞 조사](tray-app-framework.md#5-비밀-저장-개인-api-키)).
  - 업데이트 뒤에도 같은 파티션(`teamid:`)을 받으려면 Apple이 발급한 인증서가 필요하다.

### TCC 허용(알림 등)은 업데이트 뒤에도 유지되는가

- **ad-hoc**: 유지되지 않는다. TN3127이 ad-hoc 서명 앱은 수정해서 다시 실행하면 마이크 허용을 다시 묻는다고 명시한다. [TN3127](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements)
- **자체 서명**: TCC는 DR로 추적하고(TN3127), 자체 서명 앱의 DR은 인증서 해시 기준이라 업데이트 뒤에도 같다(drmaker.cpp). 그래서 유지된다고 본다. 문서와 소스에서 끌어낸 추론이고, 실기로는 확인하지 않았다.
- **알림 권한**: OS 알림 허용이 TCC처럼 DR로 추적되는지 다룬 Apple 문서를 찾지 못했다. 미확인이다.
- 추론: 이 앱에서 TCC가 걸릴 만한 곳은 따로 있다. 에이전트 CLI가 문서·데스크톱 같은 보호 폴더 안의 저장소를 읽을 때 앱 이름으로 "파일 및 폴더" 허용을 물을 수 있다. ad-hoc이면 이 허용도 업데이트마다 다시 묻게 된다.

### 브라우저로 받은 자체 서명 앱을 macOS 15 이상에서 열 때

- **문서로 확정되는 것**
  - Gatekeeper는 처음 실행 전에 Mac App Store나 Developer ID 인증서 서명을 요구한다. [About Code Signing](https://developer.apple.com/library/archive/documentation/Security/Conceptual/CodeSigningGuide/AboutCS/AboutCS.html)
  - 자체 서명은 Gatekeeper에 통하지 않는다(같은 문서). Apple은 자체 서명 인증서로 서명한 앱을 배포하지 말라고 한다. [Code Signing Tasks](https://developer.apple.com/library/archive/documentation/Security/Conceptual/CodeSigningGuide/Procedures/Procedures.html)
  - 따라서 자체 서명은 시스템 설정 > 개인정보 보호 및 보안 절차를 없애 주지 못한다.
- **어느 경고로 가는지는 문서로 확정되지 않는다**
  - Apple DTS(Quinn)는 Gatekeeper 경고 문구가 문제의 종류와 macOS 릴리스에 따라 달라진다고만 적는다. [Resolving Trusted Execution Problems](https://developer.apple.com/forums/thread/706442)
  - Apple 지원 문서는 "변경되거나 손상된 소프트웨어"를 감지하면 손상 경고를 띄운다고 설명한다. [Safely open apps on your Mac](https://support.apple.com/en-us/102445)
  - 추론: 자체 서명은 서명 자체가 유효하다. 그래서 "손상됨"보다는 ad-hoc과 같은 "확인할 수 없음 → 그래도 열기" 경로일 가능성이 높다.
  - [미서명 Tauri 앱 macOS 실기 검증](../issues/11-tauri-macos-unsigned-check.md)에 자체 서명 변형을 함께 넣어 확인하는 것이 가장 싼 검증이다.

### Electron 42 이상 macOS 알림과 자체 서명 인증서

- [PR #47817](https://github.com/electron/electron/pull/47817)(2026-03-05 병합)이 macOS 알림을 `UNNotification`으로 바꿨다.
- 같은 PR이 CI 워크플로도 고쳤다. [pipeline-segment-electron-test.yml](https://github.com/electron/electron/blob/main/.github/workflows/pipeline-segment-electron-test.yml)
  - 이전: x64에서만 다시 서명했다. 주석은 arm64 빌드가 이미 ad-hoc 서명돼 있고, 신뢰되지 않은 인증서로 다시 서명하면 Dock 바운스 같은 시스템 연동이 깨진다고 적었다.
  - 이후: 두 아키텍처 모두 자체 서명 인증서로 다시 서명한다. 주석은 UNNotifications와 Dock 바운스 같은 시스템 연동이 테스트에서 동작하게 하려는 것이라고 적는다.
- **자체 서명 인증서를 만드는 방법** ([generate-identity.sh](https://github.com/electron/electron/blob/main/script/codesign/generate-identity.sh), [codesign.cnf](https://github.com/electron/electron/blob/main/script/codesign/codesign.cnf))
  - `openssl req -new -newkey rsa:2048 -x509 -days 7300 -nodes`로 만든다. 확장은 `keyUsage = critical,digitalSignature`, `extendedKeyUsage = critical,codeSigning`이다.
  - macOS 15 이상은 SIP·TCC가 시스템 Keychain 수정을 막는다. 그래서 사용자 범위의 별도 Keychain을 만들어 쓴다.
  - `security import ... -T /usr/bin/codesign`으로 가져오고, `security set-key-partition-list -S apple-tool:,apple:,codesign: -s`로 codesign이 묻지 않고 키를 쓰게 한다.
  - 인증서를 시스템 신뢰 설정에 추가하는 단계(`add-trusted-cert`)는 없다.
- **서명**: [get-trusted-identity.sh](https://github.com/electron/electron/blob/main/script/codesign/get-trusted-identity.sh)가 `security find-identity -p codesigning` 결과의 첫 ID를 고른다. 이어서 `codesign -s "$identity" --deep --force Electron.app`으로 서명하고 `lsregister`로 등록한다.
- **테스트**: [api-notification.spec.ts](https://github.com/electron/electron/blob/main/spec/api-notification.spec.ts)의 macOS 테스트가 `show` 이벤트를 기다린다.
  - `show`는 `addNotificationRequest`가 오류 없이 끝날 때 나온다. [cocoa_notification.mm](https://github.com/electron/electron/blob/main/shell/browser/notifications/mac/cocoa_notification.mm)
  - 같은 테스트 파일 주석은 `getHistory`가 코드 서명된 빌드에서만 결과를 준다며, 비어 있으면 내용 검사를 건너뛴다.
- 추론
  - Electron 팀은 자체 서명 인증서면 UNNotification 요청이 성공한다는 것을 CI에서 계속 확인한다.
  - 다만 CI는 quarantine이 없는 환경이다. 그리고 `show`는 요청이 받아들여진 시점이라, 사용자 화면에 배너가 실제로 떴는지까지는 보장하지 않는다.
  - ad-hoc만으로 부족하다는 근거는 바뀌기 전 주석뿐이라 간접적이다.

### 자체 서명 인증서를 CI와 Tauri에서 쓰는 방법

- **Tauri 설정**: `tauri.conf.json > bundle > macOS > signingIdentity` 또는 `APPLE_SIGNING_IDENTITY` 환경 변수에 Keychain 항목 이름을 준다. [macOS Code Signing](https://v2.tauri.app/distribute/sign/macos/)
- **`APPLE_CERTIFICATE` 경로는 자체 서명에 쓸 수 없다** (소스로 확인)
  - [tauri-bundler sign.rs](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-bundler/src/bundle/macos/sign.rs)의 `keychain()`은 `APPLE_CERTIFICATE`와 `APPLE_CERTIFICATE_PASSWORD`가 있으면 임시 Keychain에 가져온 뒤 서명 ID를 찾는다.
  - 그 탐색([identity.rs](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-macos-sign/src/keychain/identity.rs) `list`)은 인증서 이름이 `Developer ID Application:`, `Apple Development:` 같은 Apple 접두사로 시작하는 것만 찾는다. OU(팀 ID)도 있어야 한다.
  - 그래서 자체 서명 인증서는 찾지 못하고 `ResolveSigningIdentity` 오류로 끝난다.
  - 두 변수가 없고 `signingIdentity`만 있으면 그 이름으로 `codesign --force -s <ID>`를 실행한다. 이때 기본 Keychain 검색 목록을 쓴다. [keychain.rs](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-macos-sign/src/keychain.rs)
- **GitHub Actions 절차** (추론. 위 Electron 스크립트와 Tauri 문서의 CI 예제가 같은 `security` 명령을 쓴다)
  1. 인증서를 한 번만 만든다. `openssl`로 코드 서명 EKU를 넣고 유효 기간을 길게 잡는다. `.p12`를 base64로 GitHub 비밀값에 넣는다. 비밀값 이름으로 `APPLE_CERTIFICATE`는 피한다.
  2. macOS 러너에서 Keychain을 만들고 잠금을 푼다. `security import -T /usr/bin/codesign`과 `security set-key-partition-list -S apple-tool:,apple:,codesign:`을 실행하고, `security list-keychains -d user -s`로 검색 목록에 넣는다.
  3. `APPLE_SIGNING_IDENTITY`에 인증서 CN이나 SHA-1 해시를 넣고 `tauri build`(또는 `tauri-action`)를 실행한다.
  - `security find-identity -v`는 유효한(신뢰된) ID만 보여 준다. 그래서 신뢰 설정이 없는 자체 서명 인증서는 이 목록에 안 나올 수 있다. Electron 스크립트처럼 `-v` 없이 확인한다.
- **운영 주의** (추론)
  - 같은 인증서를 계속 써야 한다. 인증서를 잃거나 새로 만들면 DR이 바뀌어 TCC 허용을 모두 다시 묻는다.
  - 개인 키가 새면 남이 같은 DR을 만족하는 코드를 만들 수 있다.
  - Tauri는 `hardenedRuntime`이 기본 `true`라 `--options runtime`을 붙여 서명한다([config.rs](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-utils/src/config.rs)). 팀 ID가 없는 자체 서명과 이 조합에 문제가 없는지는 확인하지 못했다.

## 5. Apple Developer Program

- **연회비**: Apple Developer Program은 연 99달러, Enterprise Program은 299달러다. 가능한 지역에서는 현지 통화로 내고, 등록 과정에서 현지 통화 금액이 표시된다. [Purchase and activation](https://developer.apple.com/support/purchase-activation/), [한국어판](https://developer.apple.com/kr/support/purchase-activation/) 한국 원화 금액이 적힌 공개 페이지는 찾지 못했다.
- **조직 가입 요건** ([Enrollment](https://developer.apple.com/programs/enroll/))
  - 이중 인증이 켜진 Apple 계정. 회사 이메일 계정을 권한다.
  - 법적 서명 권한: 신청자는 Account Holder가 된다. 소유자·임원·선임 프로젝트 책임자이거나, 그런 권한을 위임받은 직원이어야 한다.
  - 계약 당사자가 될 수 있는 법인이어야 한다. DBA, 상호, 지점은 받지 않는다.
  - D-U-N-S 번호
    - Dun & Bradstreet에 무료로 신청할 수 있다. 발급에 최대 영업일 5일, Apple에 전달되는 데 최대 영업일 2일이 걸린다. [D-U-N-S Number](https://developer.apple.com/help/account/membership/D-U-N-S/)
  - 조직 도메인의 업무용 이메일
  - 조직 도메인의 공개 웹사이트. 소셜 미디어 페이지나 내용이 거의 없는 사이트는 받지 않는다.
- **공증하면 설치 경험이 이렇게 바뀐다**
  - Developer ID로 서명하고 공증한 앱은 "확인된 개발자" 앱이다. 처음 열 때 인터넷에서 받은 앱인데 열겠느냐고 한 번 묻는 것으로 끝난다. 시스템 설정의 "그래도 열기"와 로그인 암호 입력이 필요 없다. [Safely open apps on your Mac](https://support.apple.com/en-us/102445)
  - 추론: Developer ID 서명은 `teamid:` 파티션과 안정적인 DR을 준다. 그래서 업데이트 뒤 Keychain·TCC 재허용도 사라질 것으로 본다(4절 소스 근거).
  - Tauri에서는 `Developer ID Application` 인증서와 공증 자격 증명이 필요하다. 자격 증명은 App Store Connect API 키, 또는 Apple ID·앱 암호·팀 ID 조합이다. 무료 계정으로는 공증할 수 없다. [macOS Code Signing](https://v2.tauri.app/distribute/sign/macos/)

## 확인하지 못한 것

1. **자체 서명 앱의 Gatekeeper 경로**: quarantine이 붙은 DMG를 macOS 15·26·27에서 열 때 "그래도 열기" 경로인지 "손상됨" 경로인지 확인해야 한다. 티켓 11에 자체 서명 변형을 추가해 ad-hoc과 비교하면 된다.
2. **자체 서명 앱의 Keychain 재허용**: 업데이트 뒤 실제로 다시 묻는지, 묻는다면 로그인 암호 입력을 요구하는지 확인해야 한다. 소스로는 다시 묻는다고 추론했다.
3. **TCC·알림 권한 유지**: 자체 서명 앱이 업데이트 뒤 파일·폴더 허용과 알림 허용을 유지하는지 확인해야 한다.
4. **Electron UNNotification**: 자체 서명한 Electron 42 이상 앱을 브라우저로 받아 설치했을 때 실제로 배너가 뜨는지 확인해야 한다.
5. **Tauri `hardenedRuntime` 기본값과 자체 서명 조합**이 실행에 문제를 일으키지 않는지 확인해야 한다.
6. **"기업 관리 장치"의 판정 기준**: SAC가 48시간 안에 꺼지는 조건이 Intune 등록인지 도메인 가입인지 문서에 없다.
7. **한국 법인의 Artifact Signing 실제 심사**
   - Business Identifier 형식, 한국어 법인명의 인증서 표기, 추가로 요구할 서류(영문 등기 등)를 확인해야 한다.
   - 원화 청구 시 세금도 확인해야 한다.
8. **SmartScreen 평판 승계**: 해마다 OV 인증서를 다시 받을 때, 그리고 Artifact Signing 인증서가 매일 바뀔 때 평판이 무엇에 묶이는지 문서에 없다.
9. **Apple Developer Program 원화 연회비**: 등록 화면에서만 보인다.
10. **Azure Key Vault 키 증명을 받아 주는 CA**와 그 비용을 확인하지 못했다.
11. **GlobalSign 가격**: 가격표가 스크립트로 그려져 읽지 못했다.
12. **SAC가 켜진 PC에서 에이전트 CLI**(`claude`, `codex`, Node 등)가 실행되는지 확인해야 한다. 우리 앱 서명과 별개로, 이 도구들의 서명 상태에 달려 있다.
13. **앱 안 업데이터와 quarantine**
    - Apple DTS는 `curl` 같은 Unix 계열 도구가 quarantine을 붙이지 않는다고 설명한다([706442](https://developer.apple.com/forums/thread/706442)).
    - 그래서 Tauri 업데이터로 받은 업데이트는 Gatekeeper 절차를 다시 거치지 않을 수 있다(추론).
    - Tauri 업데이터는 서명 키를 따로 요구하고 끌 수 없다. [Updater](https://v2.tauri.app/plugin/updater/) 실제 동작은 확인하지 않았다.
14. **무료 Apple 계정의 개발용 인증서**: 무료 계정으로 받는 `Apple Development` 인증서도 `teamid:` 파티션을 받는다(clientid.cpp). 하지만 팀원에게 배포하는 것이 Apple 약관상 허용되는지, Gatekeeper에서 어떻게 보이는지 확인하지 않았다.

## 서명 정책 결정에 주는 함의 (추론)

1. **Windows**
   - SAC가 켜진 PC를 지원하려면 서명이 필요하다. 대한민국 법인은 Artifact Signing에 가입할 수 있다.
   - Basic(월 9.99달러)이 OV 인증서에 클라우드 키를 붙인 방식(연 약 300~1,000달러)보다 싸고 CI 연동도 단순하다.
   - 신원 확인에 영업일 최대 20일이 걸린다. 팀 배포 단계에 맞추려면 미리 신청해야 한다.
2. **SmartScreen 경고**: 서명해도 사내 소수 배포에서는 사라지지 않을 가능성이 높다. 설치 안내문의 SmartScreen 절은 서명 여부와 관계없이 남긴다.
3. **macOS 자체 서명**
   - 얻는 것은 업데이트 뒤 TCC 허용 유지, Electron을 고를 경우의 알림 동작이다.
   - Keychain 재허용과 Gatekeeper "그래도 열기" 절차는 남을 가능성이 높다. ad-hoc 대비 이득이 제한적이다.
   - 티켓 11 실기 검증에 자체 서명 변형을 넣어 확인한 뒤 정하는 것이 가장 싸다.
4. **macOS 반복 확인을 확실히 없애는 길**은 Developer ID 서명과 공증이다. 연 99달러와 D-U-N-S 준비가 든다. 지도의 "범위 밖: 코드 서명과 공증"을 유지할지는 이 비용과 반복 확인 불편을 비교해 정한다.
