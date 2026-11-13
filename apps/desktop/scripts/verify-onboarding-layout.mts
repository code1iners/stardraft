import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'vite';

/** 실제 사용자 데이터와 분리한 렌더링 검사 디렉터리. */
const directory = await mkdtemp(join(tmpdir(), 'stardraft-onboarding-'));
/** Node에서 얻는 Electron 실행 파일. */
const executable: string = createRequire(import.meta.url)('electron');
try {
  await build({
    configFile: false,
    ssr: { noExternal: true },
    build: {
      ssr: fileURLToPath(new URL('../src/renderer/src/Onboarding.tsx', import.meta.url)),
      outDir: directory,
      emptyOutDir: true,
      rollupOptions: { output: { entryFileNames: 'onboarding.mjs' } },
    },
  });
  /** 앱에서 쓰는 컴포넌트와 스타일을 그대로 렌더링한다. */
  const { SetupBand } = await import(pathToFileURL(join(directory, 'onboarding.mjs')).href);
  /** 창 너비와 운영체제에 따른 줄바꿈도 검사한다. */
  const cases = ['darwin', 'win32'].flatMap(platform => [640, 820, 1200].map(width => ({ platform, width })));
  /** 완료 전후의 실제 마크업. 개인 계정이나 에이전트는 사용하지 않는다. */
  const fixtures = cases.map(({ platform, width }) => ({
    platform, width,
    states: [false, true].map(ready => renderToStaticMarkup(createElement(SetupBand, {
      snapshot: {
        appName: 'Stardraft', platform,
        onboarding: {
          detectionStarted: false, ready, start: { status: 'idle' },
          requirements: { 'flow-key': 'done', agent: 'done', 'work-folders': ready ? 'done' : 'needed' },
        },
      },
      section: 'work-folders', onSelectSection: () => {},
    }))),
  }));
  await writeFile(join(directory, 'fixtures.json'), JSON.stringify(fixtures));
  await writeFile(join(directory, 'styles.css'), await readFile(new URL('../src/renderer/src/styles.css', import.meta.url)));
  // Electron 자체의 레이아웃 엔진으로 같은 창의 설정 완료 전후 본문 위치를 비교한다.
  await writeFile(join(directory, 'probe.cjs'), `
const { app, BrowserWindow } = require('electron');
const { readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, width: 820, height: 680 });
  const fixtures = JSON.parse(readFileSync(path.join(__dirname, 'fixtures.json'), 'utf8'));
  const style = readFileSync(path.join(__dirname, 'styles.css'), 'utf8');
  const results = [];
  for (const fixture of fixtures) {
    window.setContentSize(fixture.width, 680);
    await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<meta charset="utf-8"><style>' + style + '</style><div class="settings-window"><div id="band"></div><div class="settings"><nav class="settings-nav">설정</nav><main class="settings-main">작업 폴더</main></div></div>'));
    const positions = [];
    for (const [index, markup] of fixture.states.entries()) {
      positions.push(await window.webContents.executeJavaScript('document.getElementById("band").innerHTML = ' + JSON.stringify(markup) + '; document.querySelector(".settings").getBoundingClientRect().top'));
      const available = await window.webContents.executeJavaScript('Array.from(document.querySelectorAll(".setup-band button")).some(button => button.textContent === "감지 시작" && button.checkVisibility() && !button.closest("[inert]"))');
      assert.equal(available, index === 1, '완료 전에는 시작 버튼이 숨겨지고 완료 후에만 조작 가능해야 함');
      const overflow = await window.webContents.executeJavaScript('document.documentElement.scrollWidth > innerWidth');
      assert.equal(overflow, false, '설정 띠가 창 너비를 넘으면 안 됨');
    }
    results.push({ platform: fixture.platform, width: fixture.width, before: positions[0], after: positions[1] });
  }
  writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify(results));
  app.quit();
}).catch(error => { console.error(error); app.exit(1); });
`);
  await promisify(execFile)(executable, [join(directory, 'probe.cjs'), `--user-data-dir=${join(directory, 'user-data')}`], { timeout: 30_000 });
  /** 레이아웃 결과는 실패할 때도 너비별로 모두 출력한다. */
  const results: { platform: string; width: number; before: number; after: number }[] = JSON.parse(await readFile(join(directory, 'results.json'), 'utf8'));
  console.table(results);
  for (const result of results) assert.equal(result.after, result.before, `${result.platform} ${result.width}px: 설정 완료 시 본문이 이동함`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
