# 영상·음원 출처

## 앱 화면

- Stardraft HEAD `fcbad7a30d7ac958aa00a8106c340939c2900f7f`의 실제 React 컴포넌트·스타일·트레이 이미지를 사용했다.
- 앱 라이선스: 저장소 루트 `LICENSE`(MIT).
- 인명·이메일·Flow 프로젝트·코드 저장소·키 입력은 모두 가상 데이터다. `example.test`는 예제용이다.
- macOS 메뉴 막대와 Flow 대화·게시 결과는 설명용 재현이며 화면에 표기했다.
- 예제 링크의 30분 유효 시간은 가상 저장소의 설정으로, Stardraft 자체의 동작 수치가 아니다.

## 배경음

“Wallpaper” — Kevin MacLeod (incompetech.com)

- 원본 및 라이선스 표기: https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100843
- 다운로드: https://incompetech.com/music/royalty-free/mp3-royaltyfree/Wallpaper.mp3
- Creative Commons Attribution 4.0: https://creativecommons.org/licenses/by/4.0/
- 변경: 150초 발췌, 음량 조정, 내레이션 아래 배치, 시작·끝 페이드.
- 영상 마지막에도 저작자·출처·라이선스·변경 사항을 표기했다. 게시 시 이 크레딧을 설명란에 함께 넣는다.

## 음성·효과음·글꼴

- 한국어 내레이션: macOS에 설치된 Yuna 합성 음성으로 로컬 생성. 일부 문장은 장면 길이에 맞게 시간 압축. 음성 모델 자체는 배포하지 않는다.
- 클릭·알림: HyperFrames media-use 번들 라이브러리. `.media/`의 에셋 기록과 음원을 함께 보존한다.
- Noto Sans KR: Google Fonts / SIL Open Font License. `assets/fonts/OFL.txt` 포함.
- 커서: HyperFrames 레지스트리 `oversized-cursor`의 화살표와 클릭 모션을 앱 화면 좌표에 맞춰 적용했다. 원본 컴포넌트는 `compositions/components/`에 보존했다.
- 애니메이션 런타임: GSAP 3.14.2, `assets/vendor/gsap.min.js`의 라이선스 안내를 유지했다.
