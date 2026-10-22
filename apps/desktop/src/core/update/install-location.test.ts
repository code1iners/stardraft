import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkInstallLocation, macBundlePathOf } from './install-location';

/** 테스트마다 만드는 임시 폴더. */
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'stardraft-location-'));
});

afterEach(() => {
  // 쓰기 권한을 거둔 폴더도 지울 수 있게 되돌린다.
  chmodSync(dir, 0o755);
  rmSync(dir, { recursive: true, force: true });
});

/** 권한 비트로 쓰기를 막을 수 있는 환경인지 여부. Windows 폴더는 권한 비트를 따르지 않고, root는 권한 비트를 무시한다. */
const permissionBitsApply = process.platform !== 'win32' && process.getuid?.() !== 0;

/** `parent` 안에 가짜 앱 번들을 만들고 그 경로를 돌려준다. */
function makeBundle(parent: string): string {
  /** 번들 경로. */
  const bundle = join(parent, 'Stardraft.app');
  mkdirSync(join(bundle, 'Contents', 'MacOS'), { recursive: true });
  writeFileSync(join(bundle, 'Contents', 'MacOS', 'Stardraft'), '가짜 실행 파일');
  return bundle;
}

describe('앱이 스스로 바꿀 수 있는 위치인지 확인', () => {
  it('번들과 부모 폴더에 쓸 수 있으면 스스로 바꿀 수 있는 위치다', async () => {
    await expect(checkInstallLocation(makeBundle(dir))).resolves.toBeNull();
  });

  it.runIf(permissionBitsApply)('부모 폴더에 쓸 권한이 없으면 권한이 없는 위치다', async () => {
    /** 번들 경로. */
    const bundle = makeBundle(dir);
    chmodSync(dir, 0o555);

    await expect(checkInstallLocation(bundle)).resolves.toBe('no-permission');
  });

  it.runIf(permissionBitsApply)('번들에 쓸 권한이 없으면 권한이 없는 위치다', async () => {
    /** 번들 경로. */
    const bundle = makeBundle(dir);
    chmodSync(bundle, 0o555);

    try {
      await expect(checkInstallLocation(bundle)).resolves.toBe('no-permission');
    } finally {
      chmodSync(bundle, 0o755);
    }
  });

  it('App Translocation이 옮겨 실행한 곳이면 읽기 전용 위치다', async () => {
    /** Gatekeeper가 번역 실행할 때처럼 `AppTranslocation/<UUID>/d/` 아래에 둔 번들. */
    const bundle = makeBundle(join(dir, 'AppTranslocation', '6F8D5B2E-0000-4000-8000-000000000000', 'd'));

    await expect(checkInstallLocation(bundle)).resolves.toBe('read-only');
  });

  // DMG를 붙이면 볼륨 루트에 번들이 놓인다. DMG를 만들어 붙이는 hdiutil은 몇 초씩 걸리고 들쭉날쭉해서,
  // 봉인된 읽기 전용 볼륨인 macOS 시스템 볼륨의 루트(`/`)를 같은 모양으로 대신 쓴다. 둘 다 쓰기 확인이 EROFS로 실패한다.
  it.runIf(process.platform === 'darwin')('읽기 전용 볼륨의 루트에 놓인 번들(DMG 안)이면 읽기 전용 위치다', async () => {
    await expect(checkInstallLocation('/Stardraft.app')).resolves.toBe('read-only');
  });
});

describe('macOS 번들 경로', () => {
  it('실행 파일 경로에서 앱 번들 경로를 얻는다', () => {
    expect(macBundlePathOf('/Applications/Stardraft.app/Contents/MacOS/Stardraft')).toBe('/Applications/Stardraft.app');
    expect(macBundlePathOf('/Users/tester/Applications/Stardraft.app/Contents/MacOS/Stardraft')).toBe(
      '/Users/tester/Applications/Stardraft.app',
    );
  });

  it('앱 번들 안의 실행 파일이 아니면 얻지 않는다', () => {
    expect(macBundlePathOf('/usr/local/bin/stardraft')).toBeNull();
    expect(macBundlePathOf('/Applications/Stardraft.app/Contents/Frameworks/Helper')).toBeNull();
  });
});
