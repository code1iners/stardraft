import { createRequire } from 'node:module';
import { mkdtemp, mkdir, cp, symlink, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
const root = resolve('apps/desktop');
const require = createRequire(join(root, 'package.json'));
const { build } = require('vite');
const dir = await mkdtemp(join(tmpdir(), 'stardraft-full-flow-'));
const evidence = resolve('.herdr-web-ui/onboarding-flow');
const source = name => JSON.stringify(join(root, 'src', name));
try {
  await mkdir(join(dir, 'main'));
  await cp(join(root, 'out/renderer'), join(dir, 'renderer'), { recursive: true });
  await cp(join(root, 'out/preload'), join(dir, 'preload'), { recursive: true });
  await symlink(join(root, 'node_modules'), join(dir, 'node_modules'));
  await symlink(join(root, 'resources'), join(dir, 'resources'));
  await mkdir(join(dir, 'home/.local/bin'), { recursive: true });
  await mkdir(join(dir, 'home/work/demo/.git'), { recursive: true });
  await writeFile(join(dir, 'home/.local/bin/claude'), '#!/bin/sh\nexit 99\n', { mode: 0o755 });
  await build({ configFile: false, ssr: { noExternal: true }, plugins: [{ name: 'isolated-external-ports', load(id) {
    if (id.endsWith('/core/flow/http-flow-api.ts')) return `import { FakeFlowApi } from ${source('core/fakes/fake-flow-api.ts')};
      export class HttpFlowApi extends FakeFlowApi {
        async listMentionAlarms(cursor) {
          if (globalThis.failNextBaseline) {
            globalThis.failNextBaseline = false;
            await new Promise(resolve => setTimeout(resolve, 250));
            return { ok: false, failure: { kind: 'network' } };
          }
          return super.listMentionAlarms(cursor);
        }
      }`;
    if (id.endsWith('/main/os-notifier.ts')) return `export class OsNotifier { notify(value) { globalThis.flowNotifications.push(value); } }`;
    if (id.endsWith('/core/agent/node-process-runner.ts')) return `
      import { FakeProcessRunner, exited } from ${source('core/fakes/fake-process-runner.ts')};
      import { claudeSuccessStream, fakeClaudeAuthStatus } from ${source('core/fakes/fake-claude-stream.ts')};
      import { LOGIN_SHELL_MARKERS } from ${source('core/agent/cli-discovery.ts')};
      export class NodeProcessRunner extends FakeProcessRunner { constructor() { super();
        this.respondWhen(() => true, request => {
          if (request.args.includes('-ilc')) return exited(0, [LOGIN_SHELL_MARKERS.begin, request.args.join(' ').includes('codex') ? '' : ${JSON.stringify(join(dir,'home/.local/bin/claude'))}, LOGIN_SHELL_MARKERS.path, '/usr/bin:/bin', LOGIN_SHELL_MARKERS.end].join('\\n'));
          if (!request.command.endsWith('/claude')) return exited(1);
          if (request.args.includes('--version')) return exited(0, '2.1.303 (Claude Code)');
          if (request.args.includes('auth')) return exited(0, fakeClaudeAuthStatus.loggedIn);
          return exited(0, claudeSuccessStream({ ok: true }));
        });
      } }`;
  } }], build: { ssr: join(root, 'src/main/index.ts'), outDir: join(dir, 'main'), emptyOutDir: true, target: 'node24', rollupOptions: { external: ['electron', 'better-sqlite3', 'electron-updater'], output: { format: 'cjs', entryFileNames: 'index.cjs' } } } });
  await writeFile(join(dir, 'bootstrap.cjs'), `
const { app, BrowserWindow, dialog, safeStorage, session } = require('electron');
const { mkdirSync, writeFileSync, readFileSync } = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const evidence = ${JSON.stringify(evidence)};
app.setPath('home', path.join(__dirname, 'home'));
app.setPath('appData', path.join(__dirname, 'home'));
app.setPath('userData', path.join(__dirname, 'chromium'));
globalThis.flowNotifications = [];
safeStorage.encryptStringAsync = async text => Buffer.from(text);
safeStorage.decryptStringAsync = async value => ({ result: value.toString(), shouldReEncrypt: false });
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path.join(__dirname, 'home/work')] });
dialog.showMessageBox = async (_window, options) => { throw new Error('Unexpected dialog: ' + JSON.stringify(options)); };
const errors = [];
app.on('web-contents-created', (_event, contents) => { contents.on('console-message', (_event, level, message) => { if (level >= 3) { errors.push(message); console.error('Renderer:', message); } }); contents.on('render-process-gone', (_event, details) => errors.push(JSON.stringify(details))); });
require('./main/index.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, name) { const end = Date.now() + 15000; while (Date.now() < end) { const value = await fn(); if (value) return value; await delay(40); } throw new Error('Timeout: ' + name); }
function find(view) { return BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=' + view)); }
async function evalIn(w, code) { return w.webContents.executeJavaScript(code, true); }
async function waitText(w, text) { await until(() => evalIn(w, 'document.body.innerText.includes(' + JSON.stringify(text) + ')'), text); }
async function click(w, text) { console.log('CLICK', text); await evalIn(w, '(() => { const b = Array.from(document.querySelectorAll("button")).find(b => b.textContent.trim() === ' + JSON.stringify(text) + ' && b.checkVisibility() && !b.closest("[inert]")); if (!b || b.disabled) throw new Error("Button unavailable"); b.focus(); b.click(); })()'); }
async function capture(w, name) { writeFileSync(path.join(evidence, name + '.png'), (await w.webContents.capturePage()).toPNG()); }
async function metrics(w) { return evalIn(w, '(() => { const main = document.querySelector(".settings-main"), button = Array.from(document.querySelectorAll("button")).find(b => b.textContent.trim() === "폴더 추가…"); return { top: main.getBoundingClientRect().top, scrollTop: main.scrollTop, buttonTop: button.getBoundingClientRect().top, focused: document.hasFocus(), active: document.activeElement?.textContent?.trim(), overflow: document.documentElement.scrollWidth > innerWidth }; })()'); }
(async () => {
  await app.whenReady();
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
  const popover = await until(() => find('popover'), 'first-run popover');
  await waitText(popover, '설정 열기');
  await capture(popover, '01-first-run');
  await click(popover, '설정 열기');
  const settings = await until(() => find('settings'), 'settings window');
  await waitText(settings, '개인 API 키');
  await evalIn(settings, '(() => { const input = document.getElementById("flow-api-key"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "fixture-key-only"); input.dispatchEvent(new Event("input", { bubbles: true })); })()');
  await click(settings, '확인');
  await waitText(settings, '테스트 사용자');
  await click(settings, '에이전트');
  await until(async () => (await evalIn(settings, 'window.stardraft.getSnapshot()')).onboarding.requirements.agent === 'done', 'agent connection');
  await capture(settings, '02-agent-connected');
  await click(settings, '저장소');
  await waitText(settings, '폴더 추가…');
  app.focus({ steal: true });
  settings.show();
  settings.focus();
  await until(() => evalIn(settings, 'document.hasFocus()'), 'settings focus');
  await evalIn(settings, 'Array.from(document.querySelectorAll("button")).find(b => b.textContent.trim() === "폴더 추가…").focus()');
  const before = await metrics(settings);
  await capture(settings, '03-before-completion');
  await click(settings, '폴더 추가…');
  await until(async () => (await evalIn(settings, 'window.stardraft.getSnapshot()')).onboarding.ready, 'ready');
  await waitText(settings, '필수 설정을 마쳤습니다.');
  await delay(100);
  const after = await metrics(settings);
  await capture(settings, '04-after-completion');
  assert.equal(after.top, before.top, '본문 위치');
  assert.equal(after.scrollTop, before.scrollTop, '스크롤 위치');
  assert.equal(after.focused, true, '실제 창 포커스');
  assert.equal(after.overflow, false, '가로 넘침');
  globalThis.failNextBaseline = true;
  await click(settings, '감지 시작');
  await waitText(settings, '시작하는 중…');
  assert.equal(await evalIn(settings, 'Array.from(document.querySelectorAll("button")).find(b => b.textContent.trim() === "시작하는 중…").disabled'), true);
  await waitText(settings, 'Flow에 연결할 수 없습니다.');
  assert.equal(settings.isDestroyed(), false);
  assert.equal((await evalIn(settings, 'window.stardraft.getSnapshot()')).onboarding.detectionStarted, false);
  await capture(settings, '05-start-failed');
  await click(settings, '감지 시작');
  await until(() => settings.isDestroyed(), 'settings closed');
  const empty = await until(() => find('popover'), 'post-start popover');
  await waitText(empty, '아직 멘션이 없습니다.');
  await capture(empty, '06-detection-started');
  const snapshot = await evalIn(empty, 'window.stardraft.getSnapshot()');
  assert.equal(snapshot.onboarding.detectionStarted, true);
  assert.equal(snapshot.launchAtLogin, true);
  await until(() => globalThis.flowNotifications.some(n => n.title === '멘션 감지를 시작했습니다'), 'notification requested');
  const persisted = JSON.parse(readFileSync(path.join(app.getPath('userData'), 'settings.json'), 'utf8'));
  assert.equal(persisted.detectionStarted, true);
  assert.equal(persisted.launchAtLogin, true);
  assert.equal(persisted.workFolders.length, 1);
  // 재개방도 실제 preload와 main의 창 관리자를 거친다.
  await evalIn(empty, 'void window.stardraft.send({ type: "open-settings" })');
  const reopened = await until(() => find('settings'), 'reopened settings');
  await waitText(reopened, '테스트 사용자');
  assert.equal(await evalIn(reopened, 'document.querySelector(".setup-band-stack") === null'), true);
  await capture(reopened, '07-reopened-settings');
  assert.equal(errors.length, 0, errors.join('\\n'));
  const result = { passed: true, retryPassed: true, reopenPassed: true, before, after, detectionStarted: snapshot.onboarding.detectionStarted, launchAtLogin: snapshot.launchAtLogin, persisted, notifications: globalThis.flowNotifications, rendererErrors: errors, boundaries: ['Flow 응답 대체', '에이전트 프로세스 응답 대체', '키 암호화 대체', '폴더 선택 대체', 'OS 알림 기록으로 대체'] };
  writeFileSync(path.join(evidence, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ passed: true, before, after, detectionStarted: true, rendererErrors: errors }));
  app.quit();
})().catch(error => { console.error(error, errors); writeFileSync(path.join(evidence, 'failure.txt'), String(error.stack)); app.exit(1); });
`);
  const child = spawn(require('electron'), [join(dir, 'bootstrap.cjs')], { stdio: 'inherit' });
  const timeout = setTimeout(() => child.kill('SIGKILL'), 60000);
  process.exitCode = await new Promise(resolve => child.on('exit', code => resolve(code ?? 1)));
  clearTimeout(timeout);
} finally { await rm(dir, { recursive: true, force: true }); }
