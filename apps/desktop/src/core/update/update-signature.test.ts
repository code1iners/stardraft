import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createSigningSentence,
  generateSigningKeyPair,
  isSignedByAnyKey,
  parsePublicKey,
  publicKeyOf,
  readSignatureList,
  type SignedFile,
  signUpdateFile,
} from './update-signature.mts';

/** 가짜 macOS zip("fake mac zip")의 sha512(base64). */
const MAC_ZIP_SHA512 = 'xq9ZxvvUOvQV+TJyrKeEA+K8Bwa166hKMxW2N2jb4X75Reacr+pFx7IrTifsbWqEmJJahXNuXIpLeYJ41kJ1Aw==';
/** 가짜 Windows 설치 파일("fake windows exe")의 sha512(base64). */
const WIN_SETUP_SHA512 = 'Kx0hZLDA0DLSsi3aUW8nVyKAC6X84WE5Zi+Wuw7XviUcmzsnyA8PRcfqqn/WVQO7OB0GQO/m3jW9EHSmC5mesw==';

/** 0.2.0의 macOS 업데이트 파일. */
const macZip: SignedFile = { version: '0.2.0', fileName: 'Stardraft-0.2.0-arm64-mac.zip', sha512: MAC_ZIP_SHA512 };

describe('서명 문장', () => {
  it('형식 이름, 버전, 파일 이름, sha512를 한 줄씩 담는다', () => {
    const sentence = createSigningSentence({
      version: '0.2.0',
      fileName: 'Stardraft-0.2.0-arm64-mac.zip',
      sha512: MAC_ZIP_SHA512,
    });

    expect(sentence).toBe(
      `stardraft-update-signature-v1\n0.2.0\nStardraft-0.2.0-arm64-mac.zip\n${MAC_ZIP_SHA512}`,
    );
  });

  it.each([
    ['줄바꿈이 든 버전', { version: '0.2.0\nStardraft-0.1.0-arm64-mac.zip' }],
    ['빈 버전', { version: '' }],
    ['줄바꿈이 든 파일 이름', { fileName: 'Stardraft-0.2.0-arm64-mac.zip\r' }],
    ['폴더가 붙은 파일 이름', { fileName: 'pending/Stardraft-0.2.0-arm64-mac.zip' }],
    ['Windows 폴더가 붙은 파일 이름', { fileName: 'pending\\Stardraft-0.2.0-arm64-mac.zip' }],
    ['hex로 쓴 sha512', { sha512: 'c6af59c6fbd43af415f93272aca78403e2bc0706b5eba84a3315b63768dbe17e' }],
    ['base64가 아닌 sha512', { sha512: `${MAC_ZIP_SHA512.slice(0, -2)}!!` }],
    ['64바이트가 아닌 sha512', { sha512: 'xq9ZxvvUOvQV+TJyrKeEA+K8Bwa166hKMxW2N2jb4X4=' }],
  ])('%s처럼 줄의 경계를 흐리는 값으로는 서명 문장을 만들지 않는다', (_case, change) => {
    /** 바꾸기 전의 올바른 값. */
    const file = { version: '0.2.0', fileName: 'Stardraft-0.2.0-arm64-mac.zip', sha512: MAC_ZIP_SHA512 };

    expect(() => createSigningSentence({ ...file, ...change })).toThrow();
  });
});

describe('서명과 검증', () => {
  /** 처음 만든 키. */
  const oldKey = generateSigningKeyPair();
  /** 회전할 때 더한 키. */
  const newKey = generateSigningKeyPair();

  it('서명은 서명 문장의 UTF-8 바이트에 대한 표준 Ed25519 서명이다', () => {
    /** 만든 서명. */
    const signature = signUpdateFile(macZip, oldKey.privateKey);

    /** 공개 키 목록에 들어가는 문자열(SPKI DER의 base64)로 읽은 공개 키. */
    const publicKey = createPublicKey({ key: Buffer.from(oldKey.publicKey, 'base64'), format: 'der', type: 'spki' });
    /** 형식 이름부터 sha512까지 그대로 적은 서명 문장. */
    const sentence = `stardraft-update-signature-v1\n0.2.0\nStardraft-0.2.0-arm64-mac.zip\n${MAC_ZIP_SHA512}`;
    expect(verify(null, Buffer.from(sentence, 'utf8'), publicKey, Buffer.from(signature, 'base64'))).toBe(true);
  });

  it('짝인 공개 키가 목록에 있으면 검증된다', () => {
    /** 처음 만든 키로 만든 서명 목록. */
    const signatures = [signUpdateFile(macZip, oldKey.privateKey)];

    expect(isSignedByAnyKey(macZip, signatures, [oldKey.publicKey])).toBe(true);
  });

  it.each([
    ['버전을 바꾼 파일', { version: '0.3.0' }],
    ['이름을 바꾼 파일', { fileName: 'Stardraft-0.2.0-arm64-mac-copy.zip' }],
    ['내용이 바뀐 파일(sha512가 다름)', { sha512: WIN_SETUP_SHA512 }],
  ])('%s은 원래 파일의 서명으로 검증되지 않는다', (_case, change) => {
    /** 원래 파일의 서명 목록. */
    const signatures = [signUpdateFile(macZip, oldKey.privateKey)];

    expect(isSignedByAnyKey({ ...macZip, ...change }, signatures, [oldKey.publicKey])).toBe(false);
  });

  it('목록에 없는 키로 만든 서명은 검증되지 않는다', () => {
    /** 목록에 없는 키로 만든 서명 목록. */
    const signatures = [signUpdateFile(macZip, newKey.privateKey)];

    expect(isSignedByAnyKey(macZip, signatures, [oldKey.publicKey])).toBe(false);
  });

  it('한 글자라도 바뀐 서명은 검증되지 않는다', () => {
    /** 원래 서명. */
    const signature = signUpdateFile(macZip, oldKey.privateKey);
    /** 첫 글자만 바꾼 서명. */
    const tampered = `${signature.startsWith('A') ? 'B' : 'A'}${signature.slice(1)}`;

    expect(isSignedByAnyKey(macZip, [tampered], [oldKey.publicKey])).toBe(false);
  });

  it('회전 중 두 키로 함께 서명하면 옛 키만 아는 앱도 새 키만 아는 앱도 검증한다', () => {
    /** 두 키로 함께 만든 서명 목록. */
    const signatures = [signUpdateFile(macZip, oldKey.privateKey), signUpdateFile(macZip, newKey.privateKey)];

    expect(isSignedByAnyKey(macZip, signatures, [oldKey.publicKey])).toBe(true);
    expect(isSignedByAnyKey(macZip, signatures, [newKey.publicKey])).toBe(true);
  });

  it('서명 목록이나 공개 키 목록이 비어 있으면 검증되지 않는다', () => {
    /** 처음 만든 키로 만든 서명 목록. */
    const signatures = [signUpdateFile(macZip, oldKey.privateKey)];

    expect(isSignedByAnyKey(macZip, [], [oldKey.publicKey])).toBe(false);
    expect(isSignedByAnyKey(macZip, signatures, [])).toBe(false);
  });
});

describe('업데이트 안내 파일의 서명 목록 필드', () => {
  /** 서명 하나. */
  const signature = signUpdateFile(macZip, generateSigningKeyPair().privateKey);
  /** 회전 중에 더한 다른 키의 서명. */
  const secondSignature = signUpdateFile(macZip, generateSigningKeyPair().privateKey);
  /** js-yaml로 읽은 latest-mac.yml의 파일 항목. */
  const entry = { url: 'Stardraft-0.2.0-arm64-mac.zip', sha512: MAC_ZIP_SHA512, size: 12 };

  it('파일 항목의 stardraftSignatures에서 서명 목록을 읽는다', () => {
    expect(readSignatureList({ ...entry, stardraftSignatures: [signature, secondSignature] })).toEqual([
      signature,
      secondSignature,
    ]);
  });

  it.each([
    ['필드가 없는 항목', entry],
    ['목록이 아닌 필드', { ...entry, stardraftSignatures: signature }],
    ['빈 목록', { ...entry, stardraftSignatures: [] }],
    ['문자열이 아닌 서명', { ...entry, stardraftSignatures: [signature, 42] }],
    ['base64가 아닌 서명', { ...entry, stardraftSignatures: [signature, 'not a signature'] }],
    ['64바이트가 아닌 서명', { ...entry, stardraftSignatures: [MAC_ZIP_SHA512.slice(0, 44)] }],
    ['객체가 아닌 항목', 'Stardraft-0.2.0-arm64-mac.zip'],
    ['없는 항목', undefined],
  ])('%s에서는 서명 목록을 읽지 않는다(서명 실패로 본다)', (_case, value) => {
    expect(readSignatureList(value)).toBeNull();
  });
});

describe('키 문자열', () => {
  /** 같은 길이(SPKI DER 44바이트)의 다른 종류 키인 X25519 공개 키. */
  const x25519PublicKey = generateKeyPairSync('x25519').publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

  it('만든 공개 키는 공개 키 목록에 넣을 수 있는 Ed25519 공개 키로 읽힌다', () => {
    const { publicKey } = generateSigningKeyPair();

    expect(parsePublicKey(publicKey).asymmetricKeyType).toBe('ed25519');
  });

  it.each([
    ['X25519 공개 키', x25519PublicKey],
    ['44바이트의 아무 값', Buffer.alloc(44, 7).toString('base64')],
    ['PEM으로 쓴 공개 키', generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString()],
    ['빈 값', ''],
  ])('%s도 Ed25519 공개 키로 읽지 않는다', (_case, text) => {
    expect(() => parsePublicKey(text)).toThrow(/Ed25519 공개 키/);
  });

  it('개인 키가 아닌 값으로는 서명하지 않고, 오류 문구에 그 값을 남기지 않는다', () => {
    /** 개인 키 자리에 잘못 넣은 공개 키. */
    const wrongValue = generateSigningKeyPair().publicKey;

    expect(() => signUpdateFile(macZip, wrongValue)).toThrow(/Ed25519 개인 키/);
    expect(() => signUpdateFile(macZip, wrongValue)).not.toThrow(wrongValue);
  });

  it('개인 키에서 짝인 공개 키를 얻는다', () => {
    /** 새 키 쌍. */
    const key = generateSigningKeyPair();

    expect(publicKeyOf(key.privateKey)).toBe(key.publicKey);
  });

  it('붙여 넣으며 생긴 앞뒤 공백이 있어도 같은 개인 키로 서명한다', () => {
    /** 새 키 쌍. */
    const key = generateSigningKeyPair();

    /** 끝에 줄바꿈이 붙은 개인 키로 만든 서명. */
    const signature = signUpdateFile(macZip, `${key.privateKey}\n`);

    expect(isSignedByAnyKey(macZip, [signature], [key.publicKey])).toBe(true);
  });
});
