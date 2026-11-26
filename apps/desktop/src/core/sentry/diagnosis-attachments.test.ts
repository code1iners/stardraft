import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DiagnosisAttachmentFolders, stageReproductionAttachments } from './diagnosis-attachments';

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

describe('재현 첨부 옮기기', () => {
  /** 재현 사본 대신 쓸 임시 폴더와 그 안의 파일을 만든다. 파일 크기는 바이트다. */
  function makeCopy(files: Record<string, number | string>): string {
    /** 사본. */
    const copy = makeDataDir();
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(join(copy, path, '..'), { recursive: true });
      writeFileSync(join(copy, path), typeof content === 'number' ? Buffer.alloc(content) : content);
    }
    return copy;
  }

  it('허용한 종류(png·jpg·log·txt)만 진단별 폴더로 옮기고, 넘는 것과 다른 종류는 생략한 수로 센다. 사본 안의 상대 경로와 절대 경로를 모두 받는다', async () => {
    const copy = makeCopy({ 'shots/error.png': 10, 'logs/server.log': '가짜 로그\n', 'notes.txt': 'x', 'photo.jpg': 5, 'patch.diff': 'x', 'video.mp4': 7 });
    const folders = new DiagnosisAttachmentFolders(makeDataDir());
    const staging = await folders.createStaging();

    const staged = await stageReproductionAttachments({
      copyRoot: copy,
      paths: ['shots/error.png', join(copy, 'logs/server.log'), 'notes.txt', 'photo.jpg', 'patch.diff', 'video.mp4'],
      stagingDir: staging,
      secretPatterns: [],
    });

    expect(staged).toEqual({
      attachments: [
        { name: 'error.png', sizeBytes: 10 },
        { name: 'server.log', sizeBytes: Buffer.byteLength('가짜 로그\n') },
        { name: 'notes.txt', sizeBytes: 1 },
        { name: 'photo.jpg', sizeBytes: 5 },
      ],
      omitted: 2,
    });
    expect(readdirSync(staging).sort()).toEqual(['error.png', 'notes.txt', 'photo.jpg', 'server.log']);
  });

  it('보고서 하나에 10개, 합계 20MB까지만 옮기고 나머지는 생략한다', async () => {
    /** 파일 12개(1MB씩)와 큰 파일 하나. */
    const files: Record<string, number> = { 'big.log': 19 * 1024 * 1024 };
    for (let index = 1; index <= 12; index += 1) files[`shot-${String(index).padStart(2, '0')}.png`] = 1024 * 1024;
    const copy = makeCopy(files);
    const folders = new DiagnosisAttachmentFolders(makeDataDir());

    const staged = await stageReproductionAttachments({
      copyRoot: copy,
      paths: ['big.log', ...Object.keys(files).filter((name) => name !== 'big.log')],
      stagingDir: await folders.createStaging(),
      secretPatterns: [],
    });

    // 19MB 로그 다음 1MB 그림 하나로 20MB가 차고, 나머지 11개는 생략한다.
    expect(staged.attachments.map((item) => item.name)).toEqual(['big.log', 'shot-01.png']);
    expect(staged.omitted).toBe(11);

    const many = makeCopy(Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`log-${String(index + 1).padStart(2, '0')}.txt`, 'x'])));
    const counted = await stageReproductionAttachments({
      copyRoot: many,
      paths: Array.from({ length: 12 }, (_, index) => `log-${String(index + 1).padStart(2, '0')}.txt`),
      stagingDir: await folders.createStaging(),
      secretPatterns: [],
    });
    expect(counted.attachments).toHaveLength(10);
    expect(counted.omitted).toBe(2);
  });

  it('사본 밖을 가리키는 경로, 사본 밖으로 가는 심볼릭 링크, 없는 파일, 비밀 파일 패턴에 맞는 파일은 옮기지 않는다', async () => {
    /** 사본 밖의 파일. */
    const outside = makeCopy({ 'private.txt': '사본 밖 가짜 비밀' });
    const copy = makeCopy({ 'ok.txt': 'x', 'secrets/token.txt': '가짜' });
    symlinkSync(join(outside, 'private.txt'), join(copy, 'linked.txt'));
    const folders = new DiagnosisAttachmentFolders(makeDataDir());
    const staging = await folders.createStaging();

    const staged = await stageReproductionAttachments({
      copyRoot: copy,
      paths: ['ok.txt', join(outside, 'private.txt'), '../private.txt', 'linked.txt', 'missing.log', 'secrets/token.txt'],
      stagingDir: staging,
      secretPatterns: ['secrets/**'],
    });

    expect(staged).toEqual({ attachments: [{ name: 'ok.txt', sizeBytes: 1 }], omitted: 5 });
    expect(readdirSync(staging)).toEqual(['ok.txt']);
  });

  it('이름이 겹치면 번호를 붙이고, 같은 파일을 두 번 적으면 한 번만 옮긴다', async () => {
    const copy = makeCopy({ 'a/error.png': 1, 'b/error.png': 2 });
    const folders = new DiagnosisAttachmentFolders(makeDataDir());

    const staged = await stageReproductionAttachments({
      copyRoot: copy,
      paths: ['a/error.png', 'b/error.png', 'a/error.png'],
      stagingDir: await folders.createStaging(),
      secretPatterns: [],
    });

    expect(staged).toEqual({ attachments: [{ name: 'error.png', sizeBytes: 1 }, { name: 'error-2.png', sizeBytes: 2 }], omitted: 0 });
  });

  it('옮겨 둔 첨부를 진단 폴더로 넣을 때 앞선 첨부를 먼저 지우고 넣는다. 다시 진단이 성공해도 새 첨부가 남는다', async () => {
    const folders = new DiagnosisAttachmentFolders(makeDataDir());
    mkdirSync(folders.dirOf(7), { recursive: true });
    writeFileSync(join(folders.dirOf(7), 'old.png'), 'x');
    const staging = await folders.createStaging();
    writeFileSync(join(staging, 'new.png'), 'y');

    await folders.replace(7, staging);

    expect(readdirSync(folders.dirOf(7))).toEqual(['new.png']);
    expect(existsSync(staging)).toBe(false);

    await folders.replace(7, null);
    expect(existsSync(folders.dirOf(7))).toBe(false);
  });

  it('옮겨 두기만 하고 넣지 못한 첨부는 앱을 켤 때 표에 없는 폴더로 치워진다', async () => {
    const folders = new DiagnosisAttachmentFolders(makeDataDir());
    await folders.createStaging();

    expect(await folders.removeUnknown([1])).toBe(1);
  });
});
