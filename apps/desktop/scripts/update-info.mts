// 태그 워크플로의 Release 작업이 다섯 파일을 올리기 전에 하는 검사, 서명, 재검증.
// 업데이트 안내 파일(latest*.yml)은 electron-builder가 쓰고 electron-updater가 읽는 것과 같은 js-yaml로 다룬다.
import { dump, load } from 'js-yaml';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  computeFileSha512,
  isSignedByAnyKey,
  parsePublicKey,
  publicKeyOf,
  readSignatureList,
  SIGNATURES_FIELD,
  signUpdateFile,
} from '../src/core/update/update-signature.mts';
import { releaseFileNames, SIGNING_KEY_SECRETS, type UpdateInfoTarget, updateInfoTargets } from './release-config.mts';

/** 검사하고 서명할 Release 파일 묶음. */
export type ReleaseDir = {
  /** Release에 올릴 파일을 모은 폴더. */
  dir: string;
  /** 앱 이름(package.json의 productName). */
  productName: string;
  /** 앱 버전(package.json의 version). 태그와 같은지는 태그 워크플로가 먼저 확인한다. */
  version: string;
};

/** release 환경 비밀값에서 읽은 서명 키. */
export type SigningKey = {
  /** 비밀값 이름. */
  name: (typeof SIGNING_KEY_SECRETS)[number];
  /** 개인 키. 화면과 로그에 내지 않는다. */
  privateKey: string;
  /** 짝인 공개 키. 앱 소스의 공개 키 목록과 견줄 수 있게 로그에 낸다. */
  publicKey: string;
};

/**
 * 태그 워크플로가 환경 변수로 넘긴 release 환경 비밀값에서 서명 키를 읽는다.
 * Actions는 등록하지 않은 비밀값을 빈 문자열로 넘기므로 빈 칸은 없는 것으로 본다. 하나도 없거나 키가 아닌 값이 있으면 멈춘다.
 */
export function readSigningKeys(env: Readonly<Record<string, string | undefined>>): SigningKey[] {
  /** 값이 있는 칸. */
  const keys = SIGNING_KEY_SECRETS.flatMap((name) => {
    /** 비밀값. */
    const privateKey = env[name]?.trim();
    if (!privateKey) return [];
    try {
      return [{ name, privateKey, publicKey: publicKeyOf(privateKey) }];
    } catch {
      // 비밀값 내용은 로그에 남지 않게 이름만 알린다.
      throw new Error(`release 환경 비밀값이 Ed25519 개인 키(PKCS#8 DER의 base64)가 아닙니다: ${name}`);
    }
  });
  if (keys.length === 0) {
    throw new Error(`release 환경 비밀값이 없습니다: ${SIGNING_KEY_SECRETS[0]}. pnpm release:keygen으로 서명 키를 만드세요.`);
  }
  return keys;
}

/** 검사를 통과한 업데이트 안내 파일 하나. */
type CheckedUpdateInfo = {
  /** yml을 읽은 객체. */
  content: Record<string, unknown>;
  /** 업데이트 파일 항목. `content` 안의 객체 그대로라, 고치면 다시 쓸 때 반영된다. */
  entry: Record<string, unknown>;
  /** 실제 업데이트 파일의 sha512(base64). */
  sha512: string;
  /** 실제 업데이트 파일의 바이트 수. */
  size: number;
};

/** 객체인지. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Release 폴더에 다섯 파일이 모두 있고 다른 파일은 없는지 확인한다. */
async function checkFileSet({ dir, productName, version }: ReleaseDir): Promise<void> {
  /** 있어야 하는 파일. */
  const expected = Object.values(releaseFileNames(productName, version));
  /** 폴더에 있는 이름. */
  const actual = await readdir(dir);

  /** 빠진 파일. */
  const missing = expected.filter((name) => !actual.includes(name));
  if (missing.length > 0) throw new Error(`Release 파일이 없습니다: ${missing.join(', ')}`);
  /** Release에 올리지 않는 파일. */
  const extra = actual.filter((name) => !expected.includes(name));
  if (extra.length > 0) throw new Error(`Release에 올리지 않는 파일이 섞여 있습니다: ${extra.join(', ')}`);
}

/**
 * 업데이트 안내 파일 하나를 읽어 버전, 가리키는 파일 이름, 크기, sha512가 실제 업데이트 파일과 맞는지 확인한다.
 * 앱은 이 yml의 값으로 파일을 받고 sha512를 확인하므로, 하나라도 틀리면 모든 PC의 업데이트가 실패한다.
 */
async function checkUpdateInfo({ dir, version }: ReleaseDir, { updateInfo, updateFile }: UpdateInfoTarget): Promise<CheckedUpdateInfo> {
  /** yml을 읽은 객체. */
  const content = load(await readFile(join(dir, updateInfo), 'utf8'));
  if (!isRecord(content)) throw new Error(`업데이트 안내 파일로 읽을 수 없습니다: ${updateInfo}`);
  if (content.version !== version) {
    throw new Error(`${updateInfo}의 버전(${String(content.version)})이 앱 버전(${version})과 다릅니다.`);
  }

  // 앱이 받을 파일은 OS마다 하나다. DMG가 섞이거나 이름이 어긋나면 앱이 엉뚱한 파일을 찾는다.
  /** 파일 항목. */
  const files: unknown[] = Array.isArray(content.files) ? content.files : [];
  /** 파일 항목이 가리키는 이름. */
  const urls = files.map((file) => (isRecord(file) ? String(file.url) : String(file)));
  /** 업데이트 파일 항목. */
  const [entry] = files;
  if (files.length !== 1 || !isRecord(entry) || entry.url !== updateFile) {
    throw new Error(`${updateInfo}의 파일 항목이 ${updateFile} 하나가 아닙니다: ${urls.join(', ') || '(파일 항목 없음)'}`);
  }

  /** 실제 업데이트 파일 경로. */
  const filePath = join(dir, updateFile);
  /** 실제 크기. */
  const { size } = await stat(filePath);
  if (entry.size !== size) {
    throw new Error(`${updateInfo}에 적힌 ${updateFile}의 크기(${String(entry.size)})가 실제 크기(${size})와 다릅니다.`);
  }
  /** 실제 sha512. */
  const sha512 = await computeFileSha512(filePath);
  if (entry.sha512 !== sha512) throw new Error(`${updateInfo}에 적힌 ${updateFile}의 sha512가 실제 파일과 다릅니다.`);

  // 예전 electron-updater가 읽던 path·sha512도 같은 파일을 가리켜야 한다.
  if (content.path !== undefined && content.path !== updateFile) {
    throw new Error(`${updateInfo}의 path가 업데이트 파일 이름과 다릅니다: ${String(content.path)}`);
  }
  if (content.sha512 !== undefined && content.sha512 !== sha512) {
    throw new Error(`${updateInfo}의 예전 형식 sha512가 ${updateFile}의 sha512와 다릅니다.`);
  }

  return { content, entry, sha512, size };
}

/**
 * Release 폴더가 다섯 파일만 담고, 업데이트 안내 파일의 버전·파일 이름·크기·sha512가 실제 파일과 맞는지 확인한다.
 * 통과하면 안내 파일마다 확인한 내용을 한 줄씩 돌려주고, 틀리면 이유와 함께 거부한다.
 */
export async function checkReleaseFiles(release: ReleaseDir): Promise<string[]> {
  await checkFileSet(release);

  /** 확인 결과. */
  const report: string[] = [];
  for (const target of updateInfoTargets(releaseFileNames(release.productName, release.version))) {
    /** 검사한 업데이트 파일의 크기. */
    const { size } = await checkUpdateInfo(release, target);
    report.push(`${target.updateInfo}: ${target.updateFile} ${size}바이트, sha512 일치`);
  }
  return report;
}

/** 검사를 통과한 업데이트 안내 파일과 그 이름. */
type CheckedTarget = CheckedUpdateInfo & UpdateInfoTarget;

/** Release의 업데이트 안내 파일을 모두 검사한다. 하나라도 틀리면 아무것도 고치지 않고 거부한다. */
async function checkAllUpdateInfo(release: ReleaseDir): Promise<CheckedTarget[]> {
  /** 검사한 안내 파일. */
  const checked: CheckedTarget[] = [];
  for (const target of updateInfoTargets(releaseFileNames(release.productName, release.version))) {
    checked.push({ ...target, ...(await checkUpdateInfo(release, target)) });
  }
  return checked;
}

/**
 * 업데이트 안내 파일마다 업데이트 파일 항목에 서명 목록 필드를 넣는다. 개인 키마다 서명을 하나씩 만든다(회전 중이면 둘).
 * 서명 문장의 sha512는 yml에 적힌 값이 아니라 실제 파일에서 다시 계산한 값이다. 다른 칸은 그대로 두고 electron-builder와 같은 방식으로 다시 쓴다.
 */
export async function signUpdateInfo(release: ReleaseDir, privateKeys: readonly string[]): Promise<string[]> {
  if (privateKeys.length === 0) throw new Error('서명할 개인 키가 없습니다.');

  /** 서명할 안내 파일. 모두 검사를 통과한 뒤에 하나라도 고친다. */
  const targets = await checkAllUpdateInfo(release);
  /** 서명 결과. */
  const report: string[] = [];
  for (const { updateInfo, updateFile, content, entry, sha512 } of targets) {
    /** 서명 문장에 담는 값. */
    const file = { version: release.version, fileName: updateFile, sha512 };
    // 읽은 객체를 그대로 고쳐 다른 칸과 순서를 지킨다.
    entry[SIGNATURES_FIELD] = privateKeys.map((privateKey) => signUpdateFile(file, privateKey));
    // electron-builder의 serializeToYaml과 같은 옵션이다.
    await writeFile(join(release.dir, updateInfo), dump(content, { lineWidth: 8000, noRefs: true }));
    report.push(`${updateInfo}: ${updateFile}에 서명 ${privateKeys.length}개`);
  }
  return report;
}

/**
 * 서명을 넣은 업데이트 안내 파일을 디스크에서 다시 읽어 앱 소스의 공개 키 목록으로 검증한다.
 * 앱처럼 실제 파일에서 다시 계산한 sha512로 서명 문장을 만든다. 넣은 서명은 모두 목록의 키 하나로 검증되어야 하고,
 * 목록의 키마다 그 키로 만든 서명이 있어야 한다. 회전 중 비밀값 하나가 빠지면 그 키만 아는 앱이 업데이트를 받지 못하기 때문이다.
 */
export async function verifyUpdateInfo(release: ReleaseDir, publicKeys: readonly string[]): Promise<string[]> {
  if (publicKeys.length === 0) {
    throw new Error('앱 소스의 공개 키 목록이 비어 있습니다. pnpm release:keygen으로 서명 키를 만들고 공개 키를 커밋하세요.');
  }
  // 목록에 키가 아닌 값이 있으면 앱도 그 값으로 검증하지 못한다.
  for (const publicKey of publicKeys) parsePublicKey(publicKey);

  /** 검증 결과. */
  const report: string[] = [];
  for (const { updateInfo, updateFile, entry, sha512 } of await checkAllUpdateInfo(release)) {
    /** 넣은 서명 목록. */
    const signatures = readSignatureList(entry);
    if (!signatures) throw new Error(`${updateInfo}의 ${updateFile} 항목에 서명 목록(${SIGNATURES_FIELD})이 없거나 형식이 틀립니다.`);

    /** 앱이 받은 파일로 만드는 서명 문장의 값. */
    const file = { version: release.version, fileName: updateFile, sha512 };
    /** 목록의 어떤 키로도 검증되지 않는 서명. */
    const unverified = signatures.filter((signature) => !isSignedByAnyKey(file, [signature], publicKeys));
    if (unverified.length > 0) {
      throw new Error(
        `${updateInfo}의 ${updateFile} 서명 중 앱 소스의 공개 키 목록으로 검증되지 않는 서명이 ${unverified.length}개 있습니다. release 환경 비밀값의 개인 키와 목록의 공개 키가 짝인지 확인하세요.`,
      );
    }
    /** 그 키로 만든 서명이 없는 공개 키. */
    const unsigned = publicKeys.filter((publicKey) => !isSignedByAnyKey(file, signatures, [publicKey]));
    if (unsigned.length > 0) {
      throw new Error(
        `${updateInfo}의 ${updateFile}에 이 공개 키로 만든 서명이 없습니다: ${unsigned.join(', ')}. 키를 회전하는 중이면 두 비밀값이 모두 있어야 합니다.`,
      );
    }
    report.push(`${updateInfo}: ${updateFile} 서명 ${signatures.length}개가 공개 키 ${publicKeys.length}개로 검증됨`);
  }
  return report;
}
