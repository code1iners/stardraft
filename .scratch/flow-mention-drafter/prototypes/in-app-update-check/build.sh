#!/usr/bin/env bash
# 변형과 버전을 받아 dist/<변형>-<버전>/ 에 DMG·zip·latest-mac.yml을 만든다.
# 사용: ./build.sh B 0.0.1
set -euo pipefail

cd "$(dirname "$0")"

# 변형 이름(A: 기본 ad-hoc, B: 최상위 명시 DR).
variant="$1"
# 앱 버전.
version="$2"

npm pkg set "version=${version}"
PROBE_VARIANT="${variant}" npx electron-builder --mac --publish never \
  --config.directories.output="dist/${variant}-${version}"
npm pkg set "version=0.0.1"
