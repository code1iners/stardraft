# Stardraft 최초 사용 모션 튜토리얼

HEAD `fcbad7a`를 기준으로 만든 macOS용 2분 30초 영상이다. 한국어 내레이션·화면 자막·배경음·클릭 효과음이 들어 있다. 실제 앱 화면을 가상 데이터로 렌더링했으며 실제 Flow에 연결하거나 게시하지 않는다.

## 결과물

- `renders/stardraft-first-use.mp4`: 1920×1080, 30fps 완성 영상
- `stardraft-tutorial.ko.srt`: 한국어 자막
- `index.html`, `compositions/`, `assets/`, `.media/`: HyperFrames 편집 소스·로컬 에셋
- `SPEC.md`: 제작 브리프와 장면별 프레임
- `STORYBOARD.md`: 대본과 장면 구성
- `REVIEW.md`: 검증 결과와 한계
- `CREDITS.md`: 게시 시 함께 사용할 출처와 라이선스

## 미리보기와 렌더

프로젝트 폴더에서 실행한다. Node.js 24, FFmpeg, Chromium이 필요하다. CLI 버전은 `package.json`에 고정했다. 음악·음성·폰트·GSAP는 모두 로컬 파일이므로 렌더링 중 외부 음원이나 글꼴을 가져오지 않는다.

```bash
npm run dev
npm run check
npm run render -- --quality delivery --output renders/stardraft-first-use.mp4
```

HyperFrames desktop app에서도 같은 파일을 열어 수정할 수 있다. 장면은 별도 HTML이고 내레이션은 문장별 WAV이므로 해당 장면과 음성·자막만 교체할 수 있다. 제목은 프로젝트 루트 `index.html`의 변수에서 수정한다. 강조색은 `assets/style.css`의 `#2160c4` 값을 수정한다. `index.html`의 `accent` 변수는 현재 스타일에 연결되어 있지 않다. 캡처된 앱 화면의 색상은 별도로 화면을 다시 생성해야 바뀐다.

## 화면·음성 재생성

완성된 소스를 편집·렌더하는 데는 앱의 실행이나 계정이 필요하지 않다. 아래 재생성 스크립트에는 Python 3.12 이상이 필요하다. HEAD 화면을 다시 추출할 때만 저장소 루트에서 `pnpm install --frozen-lockfile`로 앱 의존성을 준비한다. 이후 이 폴더에서:

```bash
npm ci
npx hyperframes browser ensure
node source/capture-screens.mjs
python3 source/build.py
```

`capture-screens.mjs`는 실제 앱 컴포넌트를 독립 브라우저에서 가상 상태로 렌더링한다. `build.py`의 `SCENES`가 타이밍·내레이션·자막의 원본이다. 새 음성은 macOS의 `say -v Yuna`로 만들므로 음성을 재생성할 때는 해당 음성이 설치된 Mac이 필요하다. 기존 문장을 바꿀 때는 같은 이름의 `assets/audio/<장면>-<번호>.wav`를 지운 뒤 다시 생성한다. 파일로 남은 음성을 쓰는 일반 렌더는 다른 운영체제에서도 가능하다.

프로젝트 전체를 옮길 때는 `assets/`와 숨김 폴더 `.media/`를 함께 복사한다. 배경음은 렌더와 `.media/manifest.jsonl`이 같은 `assets/audio/wallpaper-bed.wav`를 참조한다. `.hyperframes/`는 로컬 기록이므로 삭제하지 않는다. `.thumbnails/`, `.waveform-cache/`, 기존 배경음 사본 `.media/audio/bgm/bgm_001.wav`는 로컬에 보존하며 Git 대상에서 제외한다. 공개 게시 전 `CREDITS.md`를 설명란에 포함한다.
