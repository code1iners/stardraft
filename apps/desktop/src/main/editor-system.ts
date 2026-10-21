import { app, shell } from 'electron';
import { spawn } from 'node:child_process';
import { access, readdir } from 'node:fs/promises';
import type { EditorSystem } from '../core/editors/editor-opener';
import { appPlatform } from './app-identity';

/** 에디터 열기가 쓰는 OS 기능. 에디터는 앱과 따로 살아야 하므로 떼어 띄운다. */
export function editorSystem(): EditorSystem {
  return {
    platform: appPlatform(),
    homeDir: app.getPath('home'),
    env: { LOCALAPPDATA: process.env.LOCALAPPDATA, ProgramFiles: process.env.ProgramFiles },
    exists: async (path) => {
      try {
        await access(path);
        return true;
      } catch {
        return false;
      }
    },
    listDir: async (path) => {
      try {
        return await readdir(path);
      } catch {
        return [];
      }
    },
    openUrl: (url) => shell.openExternal(url),
    spawn: (command, args) =>
      new Promise((resolve, reject) => {
        // 셸을 거치지 않으므로 파일 경로의 문자가 명령으로 읽히지 않는다.
        /** 띄운 에디터 프로세스. */
        const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: false });
        child.once('error', reject);
        child.once('spawn', () => {
          child.unref();
          resolve();
        });
      }),
    openPath: async (path) => {
      /** 실패했을 때 OS가 돌려준 오류 문구. 성공하면 빈 문자열이다. */
      const failure = await shell.openPath(path);
      if (failure) throw new Error(failure);
    },
  };
}
