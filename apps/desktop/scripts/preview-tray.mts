import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

/** 검증 전용 빌드와 사용자 데이터. */
const directory = await mkdtemp(join(tmpdir(), 'stardraft-tray-'));
/** Node에서 Electron 실행 파일 경로를 얻는다. */
const require = createRequire(import.meta.url);
/** 검증에 사용하는 Electron 실행 파일. */
const executable: string = require('electron');
try {
  await build({ configFile: false, build: {
    ssr: fileURLToPath(new URL('../test/tray-native.ts', import.meta.url)),
    outDir: directory,
    emptyOutDir: false,
    target: 'node24',
    rollupOptions: { external: ['electron'], output: { format: 'es', entryFileNames: 'probe.mjs' } },
  } });
  /** 실제 앱 데이터와 분리된 검증 프로세스. */
  const child = spawn(executable, [join(directory, 'probe.mjs'), `--user-data-dir=${join(directory, 'user-data')}`], { stdio: 'inherit' });
  process.exitCode = await new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => resolve(code ?? 1));
  });
} finally {
  await rm(directory, { recursive: true, force: true });
}
