import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readLoginShell } from './cli-discovery';
import { NodeProcessRunner } from './node-process-runner';

/** 테스트마다 만드는 임시 홈 폴더. 셸의 rc 파일을 여기에 둔다. */
let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'stardraft-shell-'));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

/** 실제 프로세스를 띄우는 실행기. */
const runner = new NodeProcessRunner();

/** 셸 테스트는 POSIX에서만 돈다. */
const isPosix = process.platform !== 'win32';

/** 홈 폴더 아래 `fakebin/claude` 실행 파일을 만들고 경로를 돌려준다. */
function installFakeCli(): string {
  /** CLI를 둘 폴더. */
  const dir = join(home, 'fakebin');
  mkdirSync(dir, { recursive: true });
  /** 만든 CLI 경로. */
  const cliPath = join(dir, 'claude');
  writeFileSync(cliPath, '#!/bin/sh\necho fake\n');
  chmodSync(cliPath, 0o755);
  return cliPath;
}

/** 앱이 받은 것처럼 최소한의 환경 변수. GUI 앱은 셸의 PATH를 물려받지 못한다. */
function guiEnv(extra: Record<string, string> = {}): Record<string, string> {
  return { HOME: home, PATH: '/usr/bin:/bin:/usr/sbin:/sbin', ...extra };
}

describe('프로세스 실행기', () => {
  it('넘긴 환경 변수만 자식에게 주고 출력과 종료 코드를 돌려준다', async () => {
    const result = await runner.run({
      command: '/bin/sh',
      args: ['-c', 'printf "%s" "$ONLY_THIS"; printf "err" >&2; exit 3'],
      env: { ONLY_THIS: 'value' },
      cwd: home,
      timeoutMs: 5_000,
    });

    expect(result).toEqual({ kind: 'exited', exitCode: 3, stdout: 'value', stderr: 'err' });
  });

  it('파일이 없으면 띄우지 못했다고 돌려준다', async () => {
    const result = await runner.run({ command: join(home, 'missing'), args: [], env: {}, cwd: home, timeoutMs: 5_000 });

    expect(result.kind).toBe('spawn-failed');
  });

  it.skipIf(!isPosix)('제한 시간을 넘기면 자식 프로세스까지 끝내고 시간 초과로 돌려준다', async () => {
    // 다른 프로세스와 겹치지 않는 sleep 시간으로 남은 프로세스를 찾는다.
    const marker = '41.2345';
    const started = Date.now();
    const result = await runner.run({
      command: '/bin/sh',
      args: ['-c', `echo started; sleep ${marker}; echo never`],
      env: { PATH: '/usr/bin:/bin' },
      cwd: home,
      timeoutMs: 300,
    });

    expect(result).toEqual({ kind: 'timed-out', stdout: 'started\n', stderr: '' });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(pgrep(`sleep ${marker}`)).toBe(false);
  });
});

describe('로그인 셸에서 PATH 읽기', () => {
  it.skipIf(!existsSync('/bin/zsh'))('zsh: rc 파일의 출력과 섞여도 command -v와 PATH를 읽는다', async () => {
    const cliPath = installFakeCli();
    writeFileSync(join(home, '.zshrc'), 'echo "zshrc에서 찍은 인사"\nexport PATH="$HOME/fakebin:$PATH"\n');

    const read = await readLoginShell({ runner, shell: '/bin/zsh', env: guiEnv({ ZDOTDIR: home }), cwd: home, commandName: 'claude' });

    expect(read).toMatchObject({ kind: 'read', commandPath: cliPath });
    expect(read.kind === 'read' && read.path.split(':')).toContain(join(home, 'fakebin'));
  });

  it.skipIf(!existsSync('/bin/zsh'))('zsh: 별칭이면 경로를 받지 않고 PATH만 읽는다', async () => {
    installFakeCli();
    writeFileSync(join(home, '.zshrc'), 'export PATH="$HOME/fakebin:$PATH"\nalias claude="claude --verbose"\n');

    const read = await readLoginShell({ runner, shell: '/bin/zsh', env: guiEnv({ ZDOTDIR: home }), cwd: home, commandName: 'claude' });

    expect(read).toMatchObject({ kind: 'read', commandPath: null });
  });

  it.skipIf(!existsSync('/bin/bash'))('bash: 로그인 셸의 .bash_profile에서 바꾼 PATH를 읽는다', async () => {
    const cliPath = installFakeCli();
    writeFileSync(join(home, '.bash_profile'), 'echo "bash_profile 인사"\nexport PATH="$HOME/fakebin:$PATH"\n');

    const read = await readLoginShell({ runner, shell: '/bin/bash', env: guiEnv(), cwd: home, commandName: 'claude' });

    expect(read).toMatchObject({ kind: 'read', commandPath: cliPath });
  });

  it.skipIf(!existsSync('/bin/zsh'))(
    'zsh: rc 파일이 멈추면 5초 제한으로 끝낸다',
    async () => {
      writeFileSync(join(home, '.zshrc'), 'sleep 37.4321\n');
      const started = Date.now();

      const read = await readLoginShell({ runner, shell: '/bin/zsh', env: guiEnv({ ZDOTDIR: home }), cwd: home, commandName: 'claude' });

      expect(read).toEqual({ kind: 'timed-out' });
      expect(Date.now() - started).toBeGreaterThanOrEqual(5_000);
      expect(Date.now() - started).toBeLessThan(6_500);
      expect(pgrep('sleep 37.4321')).toBe(false);
    },
    10_000,
  );
});

/** 명령줄에 `pattern`이 든 프로세스가 남아 있는지 본다. */
function pgrep(pattern: string): boolean {
  try {
    execFileSync('pgrep', ['-f', pattern], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
