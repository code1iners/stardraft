// 앱 내 업데이트 파일의 진위를 확인하는 Ed25519 서명(ADR 0002). Node 내장 crypto만 쓴다.
// 태그 워크플로가 latest*.yml에 서명을 넣을 때와 앱이 받은 파일을 검증할 때 이 파일 하나를 함께 쓴다.
// 빌드 스크립트도 Node로 직접 불러오므로 .mts로 두고, 이 파일은 Node 내장 모듈 말고는 import하지 않는다.
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, type KeyObject, sign, verify } from 'node:crypto';
import { createReadStream } from 'node:fs';

/** 서명 문장의 형식 이름. 문장 형식을 바꾸면 옛 서명이 새 형식으로 읽히지 않게 이 이름도 바꾼다. */
export const SIGNING_SENTENCE_FORMAT = 'stardraft-update-signature-v1';
/**
 * latest*.yml의 파일 항목(`files[]`)에서 서명 목록을 담는 필드 이름. electron-builder가 쓰는 필드와 겹치지 않게 앱 이름을 붙였다.
 * electron-updater는 yml을 읽은 객체를 그대로 넘기므로 이 필드도 `update-downloaded`의 파일 항목까지 온다.
 */
export const SIGNATURES_FIELD = 'stardraftSignatures';
/** sha512 값의 바이트 수. */
const SHA512_BYTES = 64;
/** Ed25519 서명의 바이트 수. */
const SIGNATURE_BYTES = 64;
/** Ed25519 공개 키를 SPKI DER로 쓴 바이트 수. */
const PUBLIC_KEY_DER_BYTES = 44;
/** Ed25519 개인 키를 PKCS#8 DER로 쓴 바이트 수. */
const PRIVATE_KEY_DER_BYTES = 48;

/** 패딩까지 맞춘 표준 base64 문자열의 모양. */
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/**
 * 표준 base64 문자열을 정확히 `byteLength` 바이트로 푼다. 모양이 틀리거나 길이가 다르면 null.
 * `Buffer.from(…, 'base64')`는 틀린 글자를 조용히 건너뛰므로 모양을 먼저 확인한다.
 */
function decodeBase64(text: string, byteLength: number): Buffer | null {
  if (!BASE64_PATTERN.test(text)) return null;

  /** 푼 바이트. */
  const bytes = Buffer.from(text, 'base64');
  return bytes.length === byteLength ? bytes : null;
}

/** 서명 문장에 담는 업데이트 파일 정보. */
export type SignedFile = {
  /** latest*.yml의 버전. */
  version: string;
  /** 업데이트 파일 이름. latest*.yml 파일 항목의 `url`이고, 앱이 받은 파일의 이름과 같다. */
  fileName: string;
  /** 업데이트 파일의 sha512. latest*.yml과 같은 base64다. */
  sha512: string;
};

/**
 * 서명하는 짧은 서명 문장을 만든다. 형식 이름, 버전, 파일 이름, sha512를 한 줄씩 담는다.
 * 100MB가 넘는 zip에 직접 서명하지 않고 sha512로 묶으며, 버전과 파일 이름을 함께 묶어 진짜 서명이 붙은 옛 파일을 새 버전처럼 내밀지 못하게 한다.
 * 칸의 경계가 흐려지는 값(빈 값, 줄바꿈, 폴더가 붙은 파일 이름, 64바이트 base64가 아닌 sha512)은 거부한다.
 */
export function createSigningSentence({ version, fileName, sha512 }: SignedFile): string {
  // 줄바꿈이 든 값은 다음 칸을 흉내 낼 수 있다.
  if (!version || /[\r\n]/.test(version)) throw new Error(`서명 문장에 넣을 수 없는 버전입니다: ${JSON.stringify(version)}`);
  if (!fileName || /[\r\n/\\]/.test(fileName)) {
    throw new Error(`서명 문장에 넣을 수 없는 파일 이름입니다: ${JSON.stringify(fileName)}`);
  }
  if (!decodeBase64(sha512, SHA512_BYTES)) throw new Error(`sha512가 64바이트 base64가 아닙니다: ${JSON.stringify(sha512)}`);

  return [SIGNING_SENTENCE_FORMAT, version, fileName, sha512].join('\n');
}

/** 파일의 sha512를 latest*.yml과 같은 base64로 계산한다. 100MB가 넘는 파일도 메모리에 다 올리지 않고 읽어 가며 계산한다. */
export async function computeFileSha512(path: string): Promise<string> {
  /** sha512 해시. */
  const hash = createHash('sha512');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('base64');
}

/** 서명 키 한 쌍. 둘 다 한 줄 문자열이라 공개 키 목록 파일, Actions 비밀값, 비밀번호 관리자에 그대로 넣는다. */
export type SigningKeyPair = {
  /** 공개 키(SPKI DER의 base64). 앱 소스의 공개 키 목록에 들어간다. */
  publicKey: string;
  /** 개인 키(PKCS#8 DER의 base64). Actions `release` 환경 비밀값과 비밀번호 관리자에만 둔다. */
  privateKey: string;
};

/** Ed25519 키 쌍을 메모리에서 만든다. 파일로 남기지 않는다. */
export function generateSigningKeyPair(): SigningKeyPair {
  /** DER로 꺼낸 키 쌍. */
  const pair = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
  });
  return { publicKey: pair.publicKey.toString('base64'), privateKey: pair.privateKey.toString('base64') };
}

/** 공개 키 문자열(SPKI DER의 base64)을 Ed25519 공개 키로 읽는다. 아니면 거부한다. */
export function parsePublicKey(text: string): KeyObject {
  /** 공개 키 DER. */
  const der = decodeBase64(text, PUBLIC_KEY_DER_BYTES);
  /** 읽은 키. 길이가 같은 다른 종류의 키(X25519 등)도 있어 종류를 따로 본다. */
  let key: KeyObject | null = null;
  try {
    key = der && createPublicKey({ key: der, format: 'der', type: 'spki' });
  } catch {
    // 길이만 맞고 키가 아닌 값이다. 아래에서 같은 문구로 거부한다.
  }
  if (key?.asymmetricKeyType !== 'ed25519') throw new Error(`Ed25519 공개 키(SPKI DER의 base64)가 아닙니다: ${text}`);
  return key;
}

/**
 * 개인 키 문자열(PKCS#8 DER의 base64)을 Ed25519 개인 키로 읽는다. 붙여 넣으며 생긴 앞뒤 공백은 무시한다.
 * 거부할 때 키 내용은 메시지에 넣지 않는다. CI 로그에 남기 때문이다.
 */
function parsePrivateKey(text: string): KeyObject {
  /** 개인 키 DER. */
  const der = decodeBase64(text.trim(), PRIVATE_KEY_DER_BYTES);
  /** 읽은 키. */
  let key: KeyObject | null = null;
  try {
    key = der && createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
  } catch {
    // 모양만 맞고 키가 아닌 값이다. 아래에서 같은 문구로 거부한다.
  }
  if (key?.asymmetricKeyType !== 'ed25519') throw new Error('Ed25519 개인 키(PKCS#8 DER의 base64)가 아닙니다.');
  return key;
}

/** 개인 키 문자열에서 짝인 공개 키 문자열(SPKI DER의 base64)을 얻는다. */
export function publicKeyOf(privateKey: string): string {
  return createPublicKey(parsePrivateKey(privateKey)).export({ type: 'spki', format: 'der' }).toString('base64');
}

/** 개인 키로 업데이트 파일의 서명 문장에 서명해 base64 서명을 돌려준다. */
export function signUpdateFile(file: SignedFile, privateKey: string): string {
  return sign(null, Buffer.from(createSigningSentence(file), 'utf8'), parsePrivateKey(privateKey)).toString('base64');
}

/**
 * latest*.yml을 읽은 파일 항목에서 서명 목록을 꺼낸다.
 * 필드가 없거나, 비어 있거나, 64바이트 base64가 아닌 서명이 하나라도 있으면 형식이 틀린 것으로 보고 null을 돌려준다(서명 실패와 같다).
 */
export function readSignatureList(entry: unknown): string[] | null {
  /** 필드 값. */
  const value: unknown = typeof entry === 'object' && entry !== null ? Reflect.get(entry, SIGNATURES_FIELD) : undefined;
  if (!Array.isArray(value) || value.length === 0) return null;

  /** 모양이 맞는 서명. */
  const signatures = value.filter(
    (signature): signature is string => typeof signature === 'string' && decodeBase64(signature, SIGNATURE_BYTES) !== null,
  );
  return signatures.length === value.length ? signatures : null;
}

/**
 * 서명 목록 중 하나가 공개 키 목록 중 하나로 검증되면 참이다. 앱이 받은 파일을 설치 준비됨으로 둘지 정하는 서명 기준이다.
 * 키를 회전하는 동안에는 두 키로 함께 서명하므로, 옛 키만 아는 앱도 새 키만 아는 앱도 통과한다.
 * 문장으로 만들 수 없는 값, 형식이 틀린 서명, 읽을 수 없는 공개 키는 검증되지 않은 것으로 본다.
 */
export function isSignedByAnyKey(file: SignedFile, signatures: readonly string[], publicKeys: readonly string[]): boolean {
  /** 검증할 서명 문장의 바이트. */
  let message: Buffer;
  try {
    message = Buffer.from(createSigningSentence(file), 'utf8');
  } catch {
    return false;
  }

  /** 읽을 수 있는 공개 키. */
  const keys = publicKeys.flatMap((text) => {
    try {
      return [parsePublicKey(text)];
    } catch {
      return [];
    }
  });
  return signatures.some((signature) => {
    /** 서명 바이트. */
    const bytes = decodeBase64(signature, SIGNATURE_BYTES);
    return bytes !== null && keys.some((key) => verify(null, message, key, bytes));
  });
}
