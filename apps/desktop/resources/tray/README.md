# 트레이 아이콘

승인된 A 윤곽을 `idle.svg`, `review.svg`, `problem.svg`로 관리한다. 문제 취소선 주변은 투명 마스크로 비워 배경색과 관계없이 읽힌다.

`frames.json`은 SVG를 바탕으로 생성한 투명 PNG 묶음이다. macOS 템플릿용 검정 16·32px, Windows 시스템 밝은 테마용 검정과 어두운 테마용 흰색 16·20·24·32px를 포함한다. pulse는 40프레임·2초이며 CSS의 `ease-in-out` 곡선과 그룹 전체 불투명도 65–100%를 사용한다. 20번 프레임은 동작 줄이기에서 쓰는 완전한 채움이다.

- 재생성: `pnpm --filter @stardraft/desktop icons:generate`
- 원본과 생성 파일 일치 확인: `pnpm --filter @stardraft/desktop icons:check`
- 실제 트레이 검증: `pnpm --filter @stardraft/desktop preview:tray`

검증 앱은 임시 사용자 데이터로 실행되어 실제 계정이나 멘션 묶음에 연결하지 않는다. 세 상태를 나란히 표시하며 우클릭 메뉴의 종료 또는 5분 뒤 자동 종료로 정리한다. Windows에서는 시스템 테마와 100·125·150·200% 배율, 동작 줄이기, 절전·복귀를 확인한다. 자동 테스트의 테마·시계 대역은 실제 운영체제 화면 검증과 구분한다.

런타임은 모든 프레임을 시작할 때 디코딩하고 재사용한다. 틱마다 SVG 변환·픽셀 조작·파일 읽기를 하지 않는다. 생성 도구 `sharp`는 개발 의존성이다.
