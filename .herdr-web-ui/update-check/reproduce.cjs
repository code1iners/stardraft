const { createRequire } = require('node:module');
const { resolve, join } = require('node:path');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { spawnSync } = require('node:child_process');
const desktopRequire = createRequire(resolve('apps/desktop/package.json'));
const directory = mkdtempSync(join(tmpdir(), 'stardraft-update-check-'));
try {
  writeFileSync(join(directory, 'probe.cjs'), `
const { app } = require('electron');
app.getVersion = () => '0.1.3';
app.setPath('userData', ${JSON.stringify(join(directory, 'user-data'))});
const { autoUpdater } = require(${JSON.stringify(desktopRequire.resolve('electron-updater'))});
autoUpdater.forceDevUpdateConfig = true;
autoUpdater.updateConfigPath = '/Applications/Stardraft.app/Contents/Resources/app-update.yml';
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;
autoUpdater.allowPrerelease = false;
autoUpdater.logger = null;
autoUpdater.on('error', () => {});
app.whenReady().then(async () => {
  try {
    const result = await autoUpdater.checkForUpdates();
    console.log(JSON.stringify({ passed: true, updateAvailable: result?.isUpdateAvailable }));
    app.exit(0);
  } catch (error) {
    console.log(JSON.stringify({ passed: false, code: error.code, message: error.message.split('\\n')[0] }));
    app.exit(1);
  }
});
`);
  const result = spawnSync(desktopRequire('electron'), [join(directory, 'probe.cjs')], { encoding: 'utf8', timeout: 20000 });
  process.stdout.write(result.stdout || '');
  if (result.error) console.error(result.error.message);
  process.exitCode = result.status ?? 1;
} finally { rmSync(directory, { recursive: true, force: true }); }
