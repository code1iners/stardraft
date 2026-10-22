import { load } from 'js-yaml';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateSigningKeyPair, isSignedByAnyKey, readSignatureList } from '../src/core/update/update-signature.mts';
import { checkReleaseFiles, readSigningKeys, signUpdateInfo, verifyUpdateInfo } from './update-info.mts';

/** 가짜 macOS zip의 내용. */
const MAC_ZIP = 'fake mac zip';
/** {@link MAC_ZIP}의 sha512(base64). */
const MAC_ZIP_SHA512 = 'xq9ZxvvUOvQV+TJyrKeEA+K8Bwa166hKMxW2N2jb4X75Reacr+pFx7IrTifsbWqEmJJahXNuXIpLeYJ41kJ1Aw==';
/** 가짜 Windows 설치 파일의 내용. */
const WIN_SETUP = 'fake windows exe';
/** {@link WIN_SETUP}의 sha512(base64). */
const WIN_SETUP_SHA512 = 'Kx0hZLDA0DLSsi3aUW8nVyKAC6X84WE5Zi+Wuw7XviUcmzsnyA8PRcfqqn/WVQO7OB0GQO/m3jW9EHSmC5mesw==';

/** 서명한 뒤 바꿔치기한 Windows 설치 파일의 내용. 원래 파일과 크기가 같다. */
const EVIL_WIN_SETUP = 'evil windows exe';
/** {@link EVIL_WIN_SETUP}의 sha512(base64). */
const EVIL_WIN_SETUP_SHA512 = 'BMNgyI7VYvxeK5dZG/B/0GkrQ9/EC2z0hOtD7VZiRPvkn7/UNLm6HB6EEu9A0XV5JoZDy3VvvDULwi66oZP1bA==';

/** electron-builder가 쓰는 모양의 latest-mac.yml. */
const LATEST_MAC_YML = `version: 0.2.0
files:
  - url: Stardraft-0.2.0-arm64-mac.zip
    sha512: ${MAC_ZIP_SHA512}
    size: 12
path: Stardraft-0.2.0-arm64-mac.zip
sha512: ${MAC_ZIP_SHA512}
releaseDate: '2026-10-22T01:02:03.456Z'
`;
/** electron-builder가 쓰는 모양의 latest.yml. */
const LATEST_YML = `version: 0.2.0
files:
  - url: Stardraft-Setup-0.2.0.exe
    sha512: ${WIN_SETUP_SHA512}
    size: 16
path: Stardraft-Setup-0.2.0.exe
sha512: ${WIN_SETUP_SHA512}
releaseDate: '2026-10-22T01:05:06.789Z'
`;

/** 테스트마다 만드는 Release 폴더. */
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'stardraft-release-'));
  // 두 빌드 작업의 아티팩트를 한 폴더에 모은 모습이다.
  await writeFile(join(dir, 'Stardraft-0.2.0-arm64.dmg'), 'fake mac dmg');
  await writeFile(join(dir, 'Stardraft-0.2.0-arm64-mac.zip'), MAC_ZIP);
  await writeFile(join(dir, 'latest-mac.yml'), LATEST_MAC_YML);
  await writeFile(join(dir, 'Stardraft-Setup-0.2.0.exe'), WIN_SETUP);
  await writeFile(join(dir, 'latest.yml'), LATEST_YML);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** 0.2.0 Release 폴더. */
const release = () => ({ dir, productName: 'Stardraft', version: '0.2.0' });

/** 처음 만든 서명 키. */
const oldKey = generateSigningKeyPair();
/** 회전할 때 더한 서명 키. */
const newKey = generateSigningKeyPair();
/** 앱이 macOS zip을 받은 뒤 서명 문장에 담는 값. */
const receivedMacZip = { version: '0.2.0', fileName: 'Stardraft-0.2.0-arm64-mac.zip', sha512: MAC_ZIP_SHA512 };
/** 앱이 Windows 설치 파일을 받은 뒤 서명 문장에 담는 값. */
const receivedWinSetup = { version: '0.2.0', fileName: 'Stardraft-Setup-0.2.0.exe', sha512: WIN_SETUP_SHA512 };

describe('Release 파일 검사', () => {
  it('다섯 파일이 모두 있고 업데이트 안내 파일이 실제 파일과 맞으면 통과한다', async () => {
    await expect(checkReleaseFiles(release())).resolves.toEqual([
      'latest-mac.yml: Stardraft-0.2.0-arm64-mac.zip 12바이트, sha512 일치',
      'latest.yml: Stardraft-Setup-0.2.0.exe 16바이트, sha512 일치',
    ]);
  });

  it('업데이트 안내 파일의 크기가 실제 파일과 다르면 멈춘다', async () => {
    await writeFile(join(dir, 'latest.yml'), LATEST_YML.replace('size: 16', 'size: 17'));

    await expect(checkReleaseFiles(release())).rejects.toThrow(/Stardraft-Setup-0\.2\.0\.exe.*크기/);
  });

  it('업데이트 파일이 업데이트 안내 파일을 쓴 뒤 바뀌었으면(sha512가 다르면) 멈춘다', async () => {
    await writeFile(join(dir, 'Stardraft-0.2.0-arm64-mac.zip'), 'fake mac zap');

    await expect(checkReleaseFiles(release())).rejects.toThrow(/Stardraft-0\.2\.0-arm64-mac\.zip.*sha512/);
  });

  it('업데이트 안내 파일이 다른 이름의 파일을 가리키면(공백이 든 NSIS 기본 이름 등) 멈춘다', async () => {
    await writeFile(join(dir, 'latest.yml'), LATEST_YML.replace('url: Stardraft-Setup-0.2.0.exe', 'url: Stardraft Setup 0.2.0.exe'));

    await expect(checkReleaseFiles(release())).rejects.toThrow(/latest\.yml.*Stardraft Setup 0\.2\.0\.exe/);
  });

  it('latest-mac.yml에 zip 말고 DMG까지 들어 있으면 멈춘다', async () => {
    /** DMG 항목을 더한 latest-mac.yml. */
    const withDmg = LATEST_MAC_YML.replace(
      'path:',
      `  - url: Stardraft-0.2.0-arm64.dmg\n    sha512: ${MAC_ZIP_SHA512}\n    size: 12\npath:`,
    );
    await writeFile(join(dir, 'latest-mac.yml'), withDmg);

    await expect(checkReleaseFiles(release())).rejects.toThrow(/latest-mac\.yml.*Stardraft-0\.2\.0-arm64\.dmg/);
  });

  it('업데이트 안내 파일의 버전이 앱 버전과 다르면 멈춘다', async () => {
    await writeFile(join(dir, 'latest-mac.yml'), LATEST_MAC_YML.replace('version: 0.2.0', 'version: 0.1.9'));

    await expect(checkReleaseFiles(release())).rejects.toThrow(/latest-mac\.yml.*0\.1\.9/);
  });

  it.each([
    ['path', 'path: Stardraft-Setup-0.2.0.exe', 'path: Stardraft-Setup-0.1.0.exe', /latest\.yml의 path/],
    ['sha512', `sha512: ${WIN_SETUP_SHA512}\nreleaseDate`, `sha512: ${MAC_ZIP_SHA512}\nreleaseDate`, /latest\.yml의 예전 형식 sha512/],
  ])('예전 형식의 %s가 파일 항목과 다르면 멈춘다', async (_field, before, after, message) => {
    await writeFile(join(dir, 'latest.yml'), LATEST_YML.replace(before, after));

    await expect(checkReleaseFiles(release())).rejects.toThrow(message);
  });

  it('Release에 올리지 않는 파일(blockmap 등)이 섞여 있으면 멈춘다', async () => {
    await writeFile(join(dir, 'Stardraft-Setup-0.2.0.exe.blockmap'), 'fake blockmap');

    await expect(checkReleaseFiles(release())).rejects.toThrow(/Stardraft-Setup-0\.2\.0\.exe\.blockmap/);
  });

  it('다섯 파일 중 하나라도 없으면 멈춘다', async () => {
    await rm(join(dir, 'Stardraft-0.2.0-arm64.dmg'));

    await expect(checkReleaseFiles(release())).rejects.toThrow(/Stardraft-0\.2\.0-arm64\.dmg/);
  });
});

/** 앱(electron-updater)처럼 Release 폴더의 업데이트 안내 파일을 js-yaml로 읽는다. */
async function readYml(name: string): Promise<Record<string, unknown>> {
  return load(await readFile(join(dir, name), 'utf8')) as Record<string, unknown>;
}

/** 읽은 업데이트 안내 파일의 첫 파일 항목. */
function firstEntry(content: Record<string, unknown>): unknown {
  return (content.files as unknown[])[0];
}

describe('업데이트 안내 파일 서명', () => {
  it('업데이트 파일 항목에 서명 목록을 넣고, 앱은 받은 파일의 값으로 그 서명을 검증한다', async () => {
    await signUpdateInfo(release(), [oldKey.privateKey]);

    /** 서명을 넣은 latest-mac.yml. */
    const mac = await readYml('latest-mac.yml');
    /** 서명을 넣은 latest.yml. */
    const win = await readYml('latest.yml');
    expect(isSignedByAnyKey(receivedMacZip, readSignatureList(firstEntry(mac)) ?? [], [oldKey.publicKey])).toBe(true);
    expect(isSignedByAnyKey(receivedWinSetup, readSignatureList(firstEntry(win)) ?? [], [oldKey.publicKey])).toBe(true);
  });

  it('서명 목록 말고 electron-builder가 쓴 필드는 그대로 둔다', async () => {
    await signUpdateInfo(release(), [oldKey.privateKey]);

    /** 서명을 넣은 latest-mac.yml. */
    const mac = await readYml('latest-mac.yml');
    expect(mac).toEqual({
      version: '0.2.0',
      files: [
        {
          url: 'Stardraft-0.2.0-arm64-mac.zip',
          sha512: MAC_ZIP_SHA512,
          size: 12,
          stardraftSignatures: [expect.any(String)],
        },
      ],
      path: 'Stardraft-0.2.0-arm64-mac.zip',
      sha512: MAC_ZIP_SHA512,
      releaseDate: '2026-10-22T01:02:03.456Z',
    });
  });

  it('키를 회전하는 동안에는 두 키로 함께 서명해 어느 키를 아는 앱이든 검증한다', async () => {
    await signUpdateInfo(release(), [oldKey.privateKey, newKey.privateKey]);

    /** 두 키로 서명한 latest.yml의 서명 목록. */
    const signatures = readSignatureList(firstEntry(await readYml('latest.yml'))) ?? [];
    expect(signatures).toHaveLength(2);
    expect(isSignedByAnyKey(receivedWinSetup, signatures, [oldKey.publicKey])).toBe(true);
    expect(isSignedByAnyKey(receivedWinSetup, signatures, [newKey.publicKey])).toBe(true);
  });

  it('업데이트 안내 파일이 실제 파일과 맞지 않으면 서명하지 않는다', async () => {
    await writeFile(join(dir, 'Stardraft-Setup-0.2.0.exe'), 'fake windows exf');

    await expect(signUpdateInfo(release(), [oldKey.privateKey])).rejects.toThrow(/sha512/);
    expect(firstEntry(await readYml('latest.yml'))).not.toHaveProperty('stardraftSignatures');
  });

  it('서명할 개인 키가 없으면 멈춘다', async () => {
    await expect(signUpdateInfo(release(), [])).rejects.toThrow(/개인 키/);
  });
});

describe('서명 다시 검증', () => {
  it('넣은 서명이 앱 소스의 공개 키 목록으로 모두 검증되고 목록의 키마다 서명이 있으면 통과한다', async () => {
    await signUpdateInfo(release(), [oldKey.privateKey, newKey.privateKey]);

    await expect(verifyUpdateInfo(release(), [oldKey.publicKey, newKey.publicKey])).resolves.toEqual([
      'latest-mac.yml: Stardraft-0.2.0-arm64-mac.zip 서명 2개가 공개 키 2개로 검증됨',
      'latest.yml: Stardraft-Setup-0.2.0.exe 서명 2개가 공개 키 2개로 검증됨',
    ]);
  });

  it('공개 키 목록이 비어 있으면(키를 아직 만들지 않음) 멈추고 키 만드는 명령을 알려 준다', async () => {
    await signUpdateInfo(release(), [oldKey.privateKey]);

    await expect(verifyUpdateInfo(release(), [])).rejects.toThrow(/release:keygen/);
  });

  it('목록에 없는 키로 서명했으면(새 공개 키를 커밋하지 않음 등) 멈춘다', async () => {
    await signUpdateInfo(release(), [newKey.privateKey]);

    await expect(verifyUpdateInfo(release(), [oldKey.publicKey])).rejects.toThrow(/공개 키 목록으로 검증되지 않는 서명/);
  });

  it('목록의 키 중 서명하지 않은 키가 있으면(회전 중 비밀값 하나가 빠짐) 그 공개 키를 알리며 멈춘다', async () => {
    await signUpdateInfo(release(), [newKey.privateKey]);

    await expect(verifyUpdateInfo(release(), [oldKey.publicKey, newKey.publicKey])).rejects.toThrow(oldKey.publicKey);
  });

  it('서명 목록이 없으면 멈춘다', async () => {
    await expect(verifyUpdateInfo(release(), [oldKey.publicKey])).rejects.toThrow(/서명 목록/);
  });

  it('서명한 뒤 업데이트 파일을 바꿔치기하면 업데이트 안내 파일까지 맞춰 고쳐도 멈춘다', async () => {
    await signUpdateInfo(release(), [oldKey.privateKey]);
    await writeFile(join(dir, 'Stardraft-Setup-0.2.0.exe'), EVIL_WIN_SETUP);
    await writeFile(
      join(dir, 'latest.yml'),
      (await readFile(join(dir, 'latest.yml'), 'utf8')).replaceAll(WIN_SETUP_SHA512, EVIL_WIN_SETUP_SHA512),
    );

    await expect(verifyUpdateInfo(release(), [oldKey.publicKey])).rejects.toThrow(/Stardraft-Setup-0\.2\.0\.exe/);
  });

  it('공개 키 목록에 Ed25519 공개 키가 아닌 값이 있으면 멈춘다', async () => {
    await signUpdateInfo(release(), [oldKey.privateKey]);

    await expect(verifyUpdateInfo(release(), [oldKey.publicKey, 'not-a-key'])).rejects.toThrow(/Ed25519 공개 키/);
  });
});

describe('release 환경 비밀값의 서명 키', () => {
  it('두 비밀값 중 값이 있는 것만 서명 키로 쓰고, 비밀값마다 짝인 공개 키를 알려 준다', () => {
    // Actions는 등록하지 않은 비밀값을 빈 문자열로 넘긴다.
    expect(readSigningKeys({ UPDATE_SIGNING_KEY: oldKey.privateKey, UPDATE_SIGNING_KEY_2: '' })).toEqual([
      { name: 'UPDATE_SIGNING_KEY', privateKey: oldKey.privateKey, publicKey: oldKey.publicKey },
    ]);
  });

  it('키를 회전하는 동안에는 두 비밀값을 모두 쓴다', () => {
    const keys = readSigningKeys({ UPDATE_SIGNING_KEY: oldKey.privateKey, UPDATE_SIGNING_KEY_2: newKey.privateKey });

    expect(keys.map(({ name, publicKey }) => [name, publicKey])).toEqual([
      ['UPDATE_SIGNING_KEY', oldKey.publicKey],
      ['UPDATE_SIGNING_KEY_2', newKey.publicKey],
    ]);
  });

  it('두 비밀값이 모두 비어 있으면 키 만드는 명령을 알리며 멈춘다', () => {
    expect(() => readSigningKeys({ UPDATE_SIGNING_KEY: '' })).toThrow(/UPDATE_SIGNING_KEY.*release:keygen/);
  });

  it('개인 키가 아닌 값이 든 비밀값은 이름을 알리며 멈추고, 그 값은 오류 문구에 남기지 않는다', () => {
    /** 개인 키 자리에 잘못 넣은 공개 키. */
    const wrongValue = newKey.publicKey;

    expect(() => readSigningKeys({ UPDATE_SIGNING_KEY: oldKey.privateKey, UPDATE_SIGNING_KEY_2: wrongValue })).toThrow(
      /UPDATE_SIGNING_KEY_2/,
    );
    expect(() => readSigningKeys({ UPDATE_SIGNING_KEY: oldKey.privateKey, UPDATE_SIGNING_KEY_2: wrongValue })).not.toThrow(
      wrongValue,
    );
  });
});
