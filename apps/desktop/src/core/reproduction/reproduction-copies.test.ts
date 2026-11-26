import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeProcessRunner } from '../agent/node-process-runner';
import { osascriptCloner, ReproductionCopies, type CloneEntries } from './reproduction-copies';

/** 테스트마다 만드는 임시 폴더. 원본 저장소, 사본 폴더, 재현용 환경 파일을 둔다. */
let temp: string;
/** 가짜 원본 저장소. */
let source: string;
/** 사본 폴더. */
let root: string;

beforeEach(() => {
  temp = mkdtempSync(join(tmpdir(), 'stardraft-copies-'));
  source = join(temp, 'repo');
  root = join(temp, 'copies');
  mkdirSync(join(source, '.git', 'objects'), { recursive: true });
  writeFileSync(join(source, '.git', 'config'), '[remote "origin"]\n\turl = https://fake.invalid/repo.git\n');
  mkdirSync(join(source, 'node_modules', 'fake-lib'), { recursive: true });
  writeFileSync(join(source, 'node_modules', 'fake-lib', 'index.js'), 'module.exports = 1;\n');
  mkdirSync(join(source, 'src'));
  writeFileSync(join(source, 'src', 'app.ts'), 'export const changed = "커밋하지 않은 변경";\n');
  writeFileSync(join(source, '.env'), 'FAKE_API_URL=https://dev.fake.invalid\n');
});

afterEach(() => {
  rmSync(temp, { recursive: true, force: true });
});

/** 파일 단위로 복사하는 가짜 복제. 실제 앱은 APFS 복제를 쓴다. */
const copyClone: CloneEntries = async (from, to, names) => {
  for (const name of names) await cp(join(from, name), join(to, name), { recursive: true, verbatimSymlinks: true });
};

/** 가짜 로거. */
const logger = { info: () => {}, warn: () => {}, error: () => {} };

describe('재현 사본', () => {
  it('원본 저장소를 .git만 빼고 복제한다. 의존성 폴더와 커밋하지 않은 변경이 그대로 들어가고 원본은 바뀌지 않는다', async () => {
    const copies = new ReproductionCopies({ root, clone: copyClone, logger });

    const copy = await copies.create(source, null);

    expect(readdirSync(copy).sort()).toEqual(['.env', 'node_modules', 'src']);
    expect(readFileSync(join(copy, 'src', 'app.ts'), 'utf8')).toContain('커밋하지 않은 변경');
    expect(readFileSync(join(copy, 'node_modules', 'fake-lib', 'index.js'), 'utf8')).toBe('module.exports = 1;\n');
    expect(readdirSync(source).sort()).toEqual(['.env', '.git', 'node_modules', 'src']);
  });

  it('재현용 환경 파일을 지정하면 그 파일이 사본의 .env가 되고, 지정하지 않으면 원본 .env를 그대로 쓴다', async () => {
    /** 재현용 환경 파일. */
    const envFile = join(temp, 'reproduction.env');
    writeFileSync(envFile, 'FAKE_API_URL=https://staging.fake.invalid\n');
    const copies = new ReproductionCopies({ root, clone: copyClone, logger });

    const withEnvFile = await copies.create(source, envFile);
    const withoutEnvFile = await copies.create(source, null);

    expect(readFileSync(join(withEnvFile, '.env'), 'utf8')).toBe('FAKE_API_URL=https://staging.fake.invalid\n');
    expect(readFileSync(join(withoutEnvFile, '.env'), 'utf8')).toBe('FAKE_API_URL=https://dev.fake.invalid\n');
    expect(readFileSync(join(source, '.env'), 'utf8')).toBe('FAKE_API_URL=https://dev.fake.invalid\n');
  });

  it('원본 .env가 다른 곳을 가리키는 링크여도 재현용 환경 파일로 바꿀 때 링크가 가리키는 파일을 건드리지 않는다', async () => {
    /** 링크가 가리키는 파일. */
    const target = join(temp, 'shared.env');
    writeFileSync(target, 'FAKE_SHARED=1\n');
    rmSync(join(source, '.env'));
    symlinkSync(target, join(source, '.env'));
    /** 재현용 환경 파일. */
    const envFile = join(temp, 'reproduction.env');
    writeFileSync(envFile, 'FAKE_REPRO=1\n');
    const copies = new ReproductionCopies({ root, clone: copyClone, logger });

    const copy = await copies.create(source, envFile);

    expect(lstatSync(join(copy, '.env')).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(copy, '.env'), 'utf8')).toBe('FAKE_REPRO=1\n');
    expect(readFileSync(target, 'utf8')).toBe('FAKE_SHARED=1\n');
  });

  it('실행마다 사본 폴더 아래 다른 경로에 만들고, 실제 경로(링크를 푼 것)를 돌려준다', async () => {
    const copies = new ReproductionCopies({ root, clone: copyClone, logger });

    const first = await copies.create(source, null);
    const second = await copies.create(source, null);

    expect(first).not.toBe(second);
    // macOS의 임시 폴더는 /var → /private/var 링크 아래라, 돌려준 경로는 링크를 푼 사본 폴더 아래다.
    for (const copy of [first, second]) expect(copy.startsWith(`${realpathSync(root)}/`)).toBe(true);
    expect(readdirSync(root)).toHaveLength(2);
  });

  it('복제가 실패하면 만들다 만 사본을 지우고 실패를 알린다', async () => {
    const copies = new ReproductionCopies({
      root,
      clone: async () => {
        throw new Error('clonefile 실패: 다른 볼륨');
      },
      logger,
    });

    await expect(copies.create(source, null)).rejects.toThrow();

    expect(existsSync(root) ? readdirSync(root) : []).toEqual([]);
  });

  it('사본을 지우고, 앱을 켤 때 사본 폴더를 비운다', async () => {
    const copies = new ReproductionCopies({ root, clone: copyClone, logger });
    const first = await copies.create(source, null);
    await copies.create(source, null);

    await copies.remove(first);
    expect(readdirSync(root)).toHaveLength(1);

    await copies.sweep();
    expect(existsSync(root) ? readdirSync(root) : []).toEqual([]);
  });
});

describe('APFS 복제(osascript로 부르는 clonefile)', () => {
  it.skipIf(process.platform !== 'darwin')('맨 위 항목을 폴더째 복제하고 심볼릭 링크는 링크 그대로 둔다', async () => {
    symlinkSync('/etc/hosts', join(source, 'src', 'hosts-link'));
    /** 복제할 곳. */
    const destination = join(temp, 'cloned');
    mkdirSync(destination);

    await osascriptCloner(new NodeProcessRunner())(source, destination, ['node_modules', 'src', '.env']);

    expect(readFileSync(join(destination, 'node_modules', 'fake-lib', 'index.js'), 'utf8')).toBe('module.exports = 1;\n');
    expect(readlinkSync(join(destination, 'src', 'hosts-link'))).toBe('/etc/hosts');
    expect(readFileSync(join(destination, '.env'), 'utf8')).toBe('FAKE_API_URL=https://dev.fake.invalid\n');
  });

  it.skipIf(process.platform !== 'darwin')('복제할 수 없으면(이미 있음 등) 실패를 알린다', async () => {
    /** 복제할 곳. 같은 이름이 이미 있다. */
    const destination = join(temp, 'cloned');
    mkdirSync(join(destination, 'src'), { recursive: true });

    await expect(osascriptCloner(new NodeProcessRunner())(source, destination, ['src'])).rejects.toThrow();
  });
});
