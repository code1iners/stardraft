import { describe, expect, it } from 'vitest';
import { createAfterSign, type RunCommand, verifyMacBuild } from './mac-signature.mts';

/** 명시 DR로 다시 서명한 번들에 `codesign -d -r-`가 내는 출력. */
const EXPLICIT_DR = 'designated => identifier "app.squadify.stardraft"\n';

/** 실행한 명령을 남기고, `codesign -d -r-`에는 `requirement`를 돌려주는 가짜 codesign. */
function fakeCodesign(requirement = EXPLICIT_DR) {
  /** 실행한 명령과 인수. */
  const calls: Array<[string, readonly string[]]> = [];
  /** 가짜 실행 함수. */
  const run: RunCommand = async (command, args) => {
    calls.push([command, args]);
    return { stdout: args.includes('-r-') ? requirement : '', stderr: '' };
  };
  return { calls, run };
}

/** electron-builder가 afterSign 훅에 넘기는 값 중 훅이 쓰는 것. */
function signContext(electronPlatformName: string) {
  return {
    electronPlatformName,
    appOutDir: '/build/mac-arm64',
    packager: { appInfo: { productFilename: 'Stardraft' } },
  };
}

describe('afterSign 훅', () => {
  it('macOS 빌드는 최상위 .app만 기존 엔타이틀먼트·플래그를 지킨 채 명시 DR로 다시 서명한다', async () => {
    const { calls, run } = fakeCodesign();

    await createAfterSign('app.squadify.stardraft', run)(signContext('darwin'));

    expect(calls[0]).toEqual([
      'codesign',
      [
        '--force',
        '--sign',
        '-',
        '--preserve-metadata=entitlements,flags,runtime',
        '--requirements',
        '=designated => identifier "app.squadify.stardraft"',
        '/build/mac-arm64/Stardraft.app',
      ],
    ]);
  });

  it('다시 서명한 뒤 중첩 코드까지 서명 검증을 하고 최상위 DR을 읽어 본다', async () => {
    const { calls, run } = fakeCodesign();

    await createAfterSign('app.squadify.stardraft', run)(signContext('darwin'));

    expect(calls.slice(1)).toEqual([
      ['codesign', ['--verify', '--deep', '--strict', '/build/mac-arm64/Stardraft.app']],
      ['codesign', ['-d', '-r-', '/build/mac-arm64/Stardraft.app']],
    ]);
  });

  it('Windows 빌드에서는 codesign을 부르지 않는다', async () => {
    const { calls, run } = fakeCodesign();

    await createAfterSign('app.squadify.stardraft', run)(signContext('win32'));

    expect(calls).toEqual([]);
  });

  it('최상위 DR이 명시 DR이 아니면 DMG·zip을 만들기 전에 빌드를 멈춘다', async () => {
    const { run } = fakeCodesign('# designated => cdhash H"0123456789abcdef0123456789abcdef01234567"\n');

    await expect(createAfterSign('app.squadify.stardraft', run)(signContext('darwin'))).rejects.toThrow(
      /designated => identifier "app\.squadify\.stardraft"/,
    );
  });

  it('식별자가 다른 명시 DR도 받아들이지 않는다', async () => {
    const { run } = fakeCodesign('designated => identifier "app.squadify.other"\n');

    await expect(createAfterSign('app.squadify.stardraft', run)(signContext('darwin'))).rejects.toThrow();
  });

  it('서명 검증이 실패하면 빌드를 멈춘다', async () => {
    /** `--verify`에서 실패하는 codesign. */
    const run: RunCommand = async (_command, args) => {
      if (args.includes('--verify')) throw new Error('nested code is modified or invalid');
      return { stdout: EXPLICIT_DR, stderr: '' };
    };

    await expect(createAfterSign('app.squadify.stardraft', run)(signContext('darwin'))).rejects.toThrow(
      /nested code is modified or invalid/,
    );
  });
});

describe('macOS 빌드 산출물 검사', () => {
  /** 검사할 빌드. */
  const build = { releaseDir: '/release', productName: 'Stardraft', version: '0.1.0', identifier: 'app.squadify.stardraft' };

  it('만든 .app과, zip을 ditto로 푼 .app을 같은 기준으로 검사하고 결과를 돌려준다', async () => {
    const { calls, run } = fakeCodesign();

    const report = await verifyMacBuild({ ...build, run });

    expect(calls.slice(0, 3)).toEqual([
      ['codesign', ['--verify', '--deep', '--strict', '/release/mac-arm64/Stardraft.app']],
      ['codesign', ['-d', '-r-', '/release/mac-arm64/Stardraft.app']],
      ['ditto', ['-x', '-k', '/release/Stardraft-0.1.0-arm64-mac.zip', expect.any(String)]],
    ]);
    /** zip을 푼 폴더. */
    const unzipDir = calls[2]?.[1][3];
    expect(calls.slice(3)).toEqual([
      ['codesign', ['--verify', '--deep', '--strict', `${unzipDir}/Stardraft.app`]],
      ['codesign', ['-d', '-r-', `${unzipDir}/Stardraft.app`]],
    ]);
    expect(report).toEqual([
      '/release/mac-arm64/Stardraft.app: designated => identifier "app.squadify.stardraft"',
      '/release/Stardraft-0.1.0-arm64-mac.zip: designated => identifier "app.squadify.stardraft"',
    ]);
  });

  it('zip 안의 번들이 명시 DR을 잃었으면 .app이 맞아도 실패한다', async () => {
    /** 빌드 폴더의 .app만 명시 DR이고 zip에서 푼 .app은 기본 DR인 codesign. */
    const run: RunCommand = async (_command, args) => ({
      stdout: args.at(-1)?.startsWith('/release/') ? EXPLICIT_DR : '# designated => cdhash H"0123"\n',
      stderr: '',
    });

    await expect(verifyMacBuild({ ...build, run })).rejects.toThrow(/cdhash/);
  });
});
