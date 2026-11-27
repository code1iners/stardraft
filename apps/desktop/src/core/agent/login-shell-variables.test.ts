import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { exited, FakeProcessRunner } from '../fakes/fake-process-runner';
import { readLoginShellVariables } from './login-shell-variables';
import { NodeProcessRunner } from './node-process-runner';

describe('로그인 셸 변수 읽기', () => {
  it('이름 모양인 변수만 셸 명령에 넣고, 표지 사이의 값을 읽는다. rc 파일 출력, 여러 줄 값, 빈 값과 없는 변수를 가린다', async () => {
    const runner = new FakeProcessRunner();
    runner.respondWhen(
      () => true,
      exited(0, ['rc가 찍은 줄', '__STARDRAFT_VAR__A', 'value-a', '__STARDRAFT_VAR__B', 'line1', 'line2', '__STARDRAFT_VAR__C', '__STARDRAFT_VAR__D', '', '__STARDRAFT_VARS_END__', 'rc 뒤 줄', ''].join('\n')),
    );

    const values = await readLoginShellVariables({ runner, shell: '/bin/zsh', env: { HOME: '/Users/fake' }, cwd: '/Users/fake', names: ['A', 'B', 'C', 'D', 'A', 'bad;name', '$(x)'] });

    expect(values).toEqual({ A: 'value-a', B: 'line1\nline2' });
    const [request] = runner.requests;
    expect(request?.args[0]).toBe('-ilc');
    expect(request?.args[1]).not.toContain('bad;name');
    expect(request?.args[1]).not.toContain('$(x)');
  });

  it('읽을 이름이 없으면 셸을 띄우지 않고, 끝 표지가 없거나 셸이 제한 시간을 넘기면 빈 결과다', async () => {
    const runner = new FakeProcessRunner();
    expect(await readLoginShellVariables({ runner, shell: '/bin/zsh', env: {}, cwd: '/', names: ['1BAD'] })).toEqual({});
    expect(runner.requests).toEqual([]);

    runner.respondWhen(() => true, exited(0, '__STARDRAFT_VAR__A\nvalue-a\n'));
    expect(await readLoginShellVariables({ runner, shell: '/bin/zsh', env: {}, cwd: '/', names: ['A'] })).toEqual({});

    runner.respondWhen(() => true, async () => ({ kind: 'timed-out', stdout: '', stderr: '' }));
    expect(await readLoginShellVariables({ runner, shell: '/bin/zsh', env: {}, cwd: '/', names: ['A'] })).toEqual({});
  });
});

describe('로그인 셸 변수 읽기: 실제 셸', () => {
  /** 가짜 홈. 로그인 셸이 읽을 rc 파일을 둔다. */
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'stardraft-shell-vars-'));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('앱이 받지 못한 rc 파일의 export 값을 읽는다', async () => {
    writeFileSync(join(home, '.profile'), "echo 'rc 출력'\nexport FAKE_MCP_TOKEN='fake token value'\n");

    const values = await readLoginShellVariables({
      runner: new NodeProcessRunner(),
      shell: '/bin/sh',
      env: { HOME: home, PATH: '/usr/bin:/bin' },
      cwd: home,
      names: ['FAKE_MCP_TOKEN', 'FAKE_MISSING'],
    });

    expect(values).toEqual({ FAKE_MCP_TOKEN: 'fake token value' });
  });
});
