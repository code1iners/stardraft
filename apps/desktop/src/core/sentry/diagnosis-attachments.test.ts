import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DiagnosisAttachmentFolders } from './diagnosis-attachments';

/** 시험이 만든 임시 폴더. */
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** 앱 데이터 폴더 대신 쓸 임시 폴더를 만든다. */
function makeDataDir(): string {
  /** 만든 폴더. */
  const dir = mkdtempSync(join(tmpdir(), 'diagnosis-attachments-'));
  tempDirs.push(dir);
  return dir;
}

describe('진단 첨부 폴더', () => {
  it('진단마다 앱 데이터 폴더 아래 한 곳에 폴더를 둔다', () => {
    const data = makeDataDir();
    const folders = new DiagnosisAttachmentFolders(data);

    expect(folders.dirOf(7).startsWith(data)).toBe(true);
    expect(folders.dirOf(7)).not.toBe(folders.dirOf(8));
  });

  it('진단의 첨부 폴더를 지우고, 폴더가 없어도 실패하지 않는다', async () => {
    const folders = new DiagnosisAttachmentFolders(makeDataDir());
    writeInto(folders, 7);
    writeInto(folders, 8);

    await folders.remove(7);
    await folders.remove(99);

    expect(existsSync(folders.dirOf(7))).toBe(false);
    expect(existsSync(folders.dirOf(8))).toBe(true);
  });

  it('앱을 켤 때 표에 없는 진단의 폴더만 치우고, 치운 수를 돌려준다', async () => {
    const folders = new DiagnosisAttachmentFolders(makeDataDir());
    writeInto(folders, 1);
    writeInto(folders, 2);
    writeInto(folders, 3);

    expect(await folders.removeUnknown([1, 3])).toBe(1);

    expect([1, 2, 3].map((id) => existsSync(folders.dirOf(id)))).toEqual([true, false, true]);
  });

  it('첨부 폴더를 담는 폴더가 아직 없으면 치울 것이 없다', async () => {
    const folders = new DiagnosisAttachmentFolders(join(makeDataDir(), 'none'));

    expect(await folders.removeUnknown([1])).toBe(0);
  });
});

/** 진단의 폴더에 파일 하나를 만든다. */
function writeInto(folders: DiagnosisAttachmentFolders, id: number): void {
  /** 첨부 폴더. 안에 하위 폴더까지 만든다. */
  const dir = folders.dirOf(id);
  mkdirSync(join(dir, 'nested'), { recursive: true });
  writeFileSync(join(dir, 'nested', 'a.log'), 'x');
}
