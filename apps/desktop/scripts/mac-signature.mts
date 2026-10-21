import type { AfterPackContext } from 'electron-builder';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

/** 명령의 출력. */
type CommandOutput = {
  /** 표준 출력. */
  stdout: string;
  /** 표준 오류. */
  stderr: string;
};
/** 명령을 실행하는 함수. 명령이 실패하면 거부한다. */
export type RunCommand = (command: string, args: readonly string[]) => Promise<CommandOutput>;
/** afterSign 훅이 electron-builder에게서 받는 값 중 쓰는 것. */
type SignContext = Pick<AfterPackContext, 'electronPlatformName' | 'appOutDir'> & {
  /** `.app` 이름을 정하는 앱 정보. */
  packager: { appInfo: { productFilename: string } };
};

/** 실제로 명령을 실행한다. */
const runCommand: RunCommand = (command, args) => promisify(execFile)(command, [...args]);

/** 최상위 번들에 넣는 명시 DR. 업데이트가 빌드마다 바뀌는 cdhash가 아니라 이 식별자로 서로를 검증하게 한다. */
function designatedRequirement(identifier: string): string {
  return `designated => identifier "${identifier}"`;
}

/**
 * 앱 번들의 서명을 검사한다. 중첩 코드까지 `codesign --verify --deep --strict`를 통과하고,
 * 최상위 DR이 정확히 명시 DR이어야 한다. 맞으면 읽은 DR 줄을, 틀리면 이유와 함께 거부한다.
 */
async function checkMacSignature(appPath: string, identifier: string, run: RunCommand = runCommand): Promise<string> {
  await run('codesign', ['--verify', '--deep', '--strict', appPath]);

  /** 기대하는 DR 줄. */
  const expected = designatedRequirement(identifier);
  /** `codesign -d -r-`가 표준 출력에 낸 요구사항. */
  const { stdout } = await run('codesign', ['-d', '-r-', appPath]);
  // 서명에 박힌 DR은 "designated =>"로, 시스템이 계산한 기본 DR(cdhash)은 "# designated =>"로 시작한다.
  /** 읽은 DR 줄. */
  const actual = stdout
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('designated =>') || line.startsWith('# designated =>'));
  if (actual !== expected) {
    throw new Error(`${appPath}의 최상위 DR이 \`${expected}\`가 아닙니다: ${actual ?? '(DR 없음)'}`);
  }
  return actual;
}

/** 검사할 macOS 빌드. */
type MacBuild = {
  /** electron-builder 출력 폴더. */
  releaseDir: string;
  /** 앱 이름. `.app`과 zip 이름에 쓰인다. */
  productName: string;
  /** 앱 버전. */
  version: string;
  /** 번들 ID. */
  identifier: string;
  /** 명령 실행 함수. */
  run?: RunCommand;
};

/**
 * 빌드한 `.app`과, 앱 내 업데이트가 받는 zip을 `ditto -x -k`로 푼 `.app`을 같은 기준으로 검사한다.
 * zip으로 묶는 과정에서 서명이 깨질 수 있어서(심볼릭 링크를 푼 회귀 등) zip도 따로 본다.
 * 통과하면 검사한 파일마다 읽은 DR을 한 줄씩 돌려준다.
 */
export async function verifyMacBuild({ releaseDir, productName, version, identifier, run = runCommand }: MacBuild): Promise<string[]> {
  /** 빌드 폴더의 앱 번들. */
  const appPath = join(releaseDir, 'mac-arm64', `${productName}.app`);
  /** 앱 내 업데이트용 zip. */
  const zipPath = join(releaseDir, `${productName}-${version}-arm64-mac.zip`);
  /** 검사 결과. */
  const report = [`${appPath}: ${await checkMacSignature(appPath, identifier, run)}`];

  /** zip을 풀 임시 폴더. */
  const unzipDir = await mkdtemp(join(tmpdir(), 'stardraft-zip-'));
  try {
    await run('ditto', ['-x', '-k', zipPath, unzipDir]);
    report.push(`${zipPath}: ${await checkMacSignature(join(unzipDir, `${productName}.app`), identifier, run)}`);
  } finally {
    await rm(unzipDir, { recursive: true, force: true });
  }
  return report;
}

/**
 * electron-builder가 번들 전체를 ad-hoc 서명한 뒤 부르는 훅. 최상위 번들만 명시 DR로 다시 서명한다.
 * Helper와 Framework 같은 중첩 코드는 기본 DR 서명을 그대로 둔다(ADR 0002).
 * 다시 서명한 번들이 검사를 통과하지 못하면 DMG·zip을 만들기 전에 빌드를 멈춘다.
 */
export function createAfterSign(identifier: string, run: RunCommand = runCommand): (context: SignContext) => Promise<void> {
  return async function resignTopLevelBundle(context) {
    if (context.electronPlatformName !== 'darwin') return;

    /** 서명할 앱 번들. */
    const appPath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
    // --deep 없이 서명해 중첩 코드는 건드리지 않는다.
    await run('codesign', [
      '--force',
      '--sign',
      '-',
      '--preserve-metadata=entitlements,flags,runtime',
      '--requirements',
      `=${designatedRequirement(identifier)}`,
      appPath,
    ]);
    await checkMacSignature(appPath, identifier, run);
  };
}
