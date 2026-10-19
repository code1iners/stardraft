// electron-builder afterSign 훅. 서명 뒤, DMG·zip을 만들기 전에 돈다.
// 변형 B(PROBE_VARIANT=B)에서만 최상위 번들을 명시 DR로 다시 서명한다. 중첩 코드는 그대로 둔다.
// 변형 A는 기본 ad-hoc 서명(cdhash DR)을 그대로 둔다.

const { execFileSync } = require('node:child_process');
const path = require('node:path');

/** 변형 B에서 최상위 번들에 줄 지정 요구사항. */
const EXPLICIT_DR = 'designated => identifier "app.example.updateprobe"';

/** codesign을 부르고 표준 출력과 표준 오류를 함께 돌려준다. */
function codesign(args) {
  return execFileSync('codesign', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') {
    return;
  }
  /** 변형 이름. */
  const variant = process.env.PROBE_VARIANT;
  /** 서명된 앱 번들 경로. */
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);

  // 변형 B만 최상위를 다시 서명한다.
  if (variant === 'B') {
    codesign([
      '--force',
      '--sign',
      '-',
      '--preserve-metadata=entitlements,flags,runtime',
      `-r=${EXPLICIT_DR}`,
      appPath,
    ]);
  } else if (variant !== 'A') {
    throw new Error(`PROBE_VARIANT는 A나 B여야 합니다: ${variant}`);
  }

  // 결과 확인. --verify가 실패하면 예외로 빌드를 멈춘다.
  codesign(['--verify', '--deep', '--strict', appPath]);
  /** codesign -d -r- 출력. 지정 요구사항은 표준 출력, 나머지는 표준 오류로 나온다. */
  const requirement = execFileSync('codesign', ['-d', '-r-', appPath], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  console.log(`[after-sign] variant=${variant} ${appPath}\n${requirement.trim()}`);
};
