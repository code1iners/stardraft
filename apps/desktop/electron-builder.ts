import { execFileSync } from 'node:child_process';
import { createBuildConfig } from './scripts/build-config.mts';

/** 이 저장소의 `origin` 원격 주소. 원격이 없거나 git을 쓸 수 없으면 null. */
function readOriginUrl(): string | null {
  try {
    return execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

// electron-builder가 이 파일을 설정으로 읽는다. 빌드 명령은 package.json의 `dist`다.
export default () => createBuildConfig({ env: process.env, originUrl: readOriginUrl() });
