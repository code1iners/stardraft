import { ESLint } from 'eslint';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** 데스크톱 앱 패키지 루트. ESLint 설정을 여기서 찾는다. */
const packageRoot = fileURLToPath(new URL('..', import.meta.url));

/** 주어진 경로에 있다고 치고 코드를 검사해, 걸린 규칙 이름을 돌려준다. */
async function lintAs(filePath: string, code: string): Promise<string[]> {
  const eslint = new ESLint({ cwd: packageRoot });
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((message) => message.ruleId ?? 'parse-error');
}

describe('import 경계', () => {
  it('core가 Electron을 import하면 lint가 실패한다', async () => {
    const rules = await lintAs('src/core/probe.ts', "import { app } from 'electron';\nexport const name = app.name;\n");

    expect(rules).toContain('no-restricted-imports');
  });

  it('core가 Electron 타입만 import해도 lint가 실패한다', async () => {
    const rules = await lintAs(
      'src/core/probe.ts',
      "import type { Tray } from 'electron';\nexport type Icon = Tray;\n",
    );

    expect(rules).toContain('no-restricted-imports');
  });

  it('core가 main을 import하면 lint가 실패한다', async () => {
    const rules = await lintAs('src/core/probe.ts', "import { start } from '../main/app';\nexport const run = start;\n");

    expect(rules).toContain('no-restricted-imports');
  });

  it('main은 Electron을 import할 수 있다', async () => {
    const rules = await lintAs('src/main/probe.ts', "import { app } from 'electron';\nexport const name = app.name;\n");

    expect(rules).toEqual([]);
  });

  it('렌더러가 Electron을 import하면 lint가 실패한다', async () => {
    const rules = await lintAs(
      'src/renderer/src/probe.ts',
      "import { ipcRenderer } from 'electron';\nexport const ipc = ipcRenderer;\n",
    );

    expect(rules).toContain('no-restricted-imports');
  });
});
