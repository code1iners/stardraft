// 앱 내 업데이트의 서명 키를 만든다. 저장소 주인이 gh에 로그인한 Mac에서 돌린다.
// 사용법: pnpm release:keygen [--rotate]
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { UPDATE_PUBLIC_KEYS } from '../src/core/update/update-public-keys.mts';
import { RELEASE_ENVIRONMENT } from './release-config.mts';
import { type KeygenPorts, runKeygen } from './update-signing-key.mts';

/** 사용법 안내. */
const USAGE = `사용법: pnpm release:keygen [--rotate]
  업데이트 서명 키(Ed25519)를 만들어 개인 키를 GitHub Actions ${RELEASE_ENVIRONMENT} 환경 비밀값과 비밀번호 관리자에 두고,
  공개 키를 앱 소스의 공개 키 목록에 씁니다. 공개 키 목록은 직접 커밋합니다.
  --rotate  유출이 의심될 때 새 키를 더합니다. 회전하는 동안 태그 워크플로가 두 키로 함께 서명합니다.`;

/** 앱 소스의 공개 키 목록 파일. */
const publicKeysFile = fileURLToPath(new URL('../src/core/update/update-public-keys.mts', import.meta.url));

/** 명령에 값을 표준 입력으로 넘겨 실행한다. 값이 프로세스 목록에 보이지 않게 인수로 넘기지 않는다. 실패하면 던진다. */
function runWithInput(command: string, args: readonly string[], input: string): void {
  /** 실행 결과. 명령의 출력은 화면에 그대로 보인다. */
  const result = spawnSync(command, args, { input, stdio: ['pipe', 'inherit', 'inherit'] });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`실패한 명령: ${command} (종료 코드 ${String(result.status)})`);
}

/** 안내를 보이고 Enter를 기다린다. Ctrl+C를 누르거나 입력이 끝나면 거부한다. */
async function waitForEnter(prompt: string): Promise<void> {
  /** 터미널 입력. */
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  /** 기다림을 끝내는 신호. */
  const abort = new AbortController();
  terminal.on('SIGINT', () => abort.abort());
  terminal.on('close', () => abort.abort());
  try {
    await terminal.question(`${prompt} `, { signal: abort.signal });
  } catch (error) {
    if (abort.signal.aborted) throw new Error('Enter를 누르지 않고 중단했습니다.', { cause: error });
    throw error;
  } finally {
    terminal.close();
  }
}

/** 실제 gh, 클립보드(pbcopy), 터미널. */
const ports: KeygenPorts = {
  async setReleaseSecret(name, value) {
    runWithInput('gh', ['secret', 'set', name, '--env', RELEASE_ENVIRONMENT], value);
  },
  async copyToClipboard(text) {
    runWithInput('pbcopy', [], text);
  },
  async clearClipboard() {
    runWithInput('pbcopy', [], '');
  },
  waitForEnter,
  print: (message) => console.log(message),
};

/** 명령 인수를 읽는다. 모르는 인수가 있으면 사용법과 함께 던진다. */
function readOptions(): { rotate: boolean; help: boolean } {
  try {
    return parseArgs({
      options: { rotate: { type: 'boolean', default: false }, help: { type: 'boolean', short: 'h', default: false } },
    }).values;
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`, { cause: error });
  }
}

try {
  /** 명령 인수. */
  const options = readOptions();
  if (options.help) {
    console.log(USAGE);
  } else {
    // 클립보드를 pbcopy로 다루므로 macOS에서만 돈다.
    if (process.platform !== 'darwin') throw new Error('pnpm release:keygen은 macOS에서 돌립니다(클립보드에 pbcopy를 씁니다).');
    await runKeygen({ rotate: options.rotate, publicKeys: UPDATE_PUBLIC_KEYS, publicKeysFile }, ports);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
