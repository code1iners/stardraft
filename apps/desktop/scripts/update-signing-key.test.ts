import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UPDATE_PUBLIC_KEYS } from '../src/core/update/update-public-keys.mts';
import { generateSigningKeyPair, publicKeyOf } from '../src/core/update/update-signature.mts';
import { type KeygenPorts, renderPublicKeysModule, runKeygen } from './update-signing-key.mts';

/** 테스트마다 만드는 임시 폴더. */
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'stardraft-keygen-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** 공개 키 목록 파일 경로. */
const publicKeysFile = () => join(dir, 'update-public-keys.mts');

/** 앱처럼 공개 키 목록 파일을 불러와 목록을 읽는다. 파일이 없으면 null. */
async function importedPublicKeys(): Promise<readonly string[] | null> {
  try {
    /** 불러온 모듈. */
    const module: { UPDATE_PUBLIC_KEYS: readonly string[] } = await import(pathToFileURL(publicKeysFile()).href);
    return module.UPDATE_PUBLIC_KEYS;
  } catch {
    return null;
  }
}

/** 가짜 바깥 경계를 만들 때 고르는 실패. */
type FakeOptions = {
  /** 비밀값 등록이 실패하는지(gh 로그인 안 됨, release 환경 없음 등). */
  failSecret?: boolean;
  /** Enter 대신 Ctrl+C로 중단하는지. */
  interrupt?: boolean;
};

/** 키 생성이 닿는 바깥 경계(gh, 클립보드, Enter 입력, 화면)의 가짜. */
function fakePorts({ failSecret = false, interrupt = false }: FakeOptions = {}) {
  /** 등록한 release 환경 비밀값. */
  const secrets = new Map<string, string>();
  /** 화면에 쓴 글. */
  const printed: string[] = [];
  /** 클립보드 상태. */
  const clipboard = {
    /** 지금 내용. */
    now: '',
    /** Enter를 기다리는 동안의 내용. 기다린 적이 없으면 null. */
    whileWaiting: null as string | null,
  };
  /** 가짜 바깥 경계. */
  const ports: KeygenPorts = {
    async setReleaseSecret(name, value) {
      if (failSecret) throw new Error('HTTP 404: Not Found');
      secrets.set(name, value);
    },
    async copyToClipboard(text) {
      clipboard.now = text;
    },
    async clearClipboard() {
      clipboard.now = '';
    },
    async waitForEnter(prompt) {
      printed.push(prompt);
      clipboard.whileWaiting = clipboard.now;
      if (interrupt) throw new Error('중단');
    },
    print(message) {
      printed.push(message);
    },
  };
  return { ports, secrets, printed, clipboard };
}

describe('업데이트 서명 키 만들기', () => {
  it('개인 키를 release 환경의 UPDATE_SIGNING_KEY로 등록하고, 짝인 공개 키 하나를 공개 키 목록 파일에 쓴다', async () => {
    const { ports, secrets } = fakePorts();

    await runKeygen({ rotate: false, publicKeys: [], publicKeysFile: publicKeysFile() }, ports);

    /** 등록한 개인 키. */
    const privateKey = secrets.get('UPDATE_SIGNING_KEY') ?? '';
    expect([...secrets.keys()]).toEqual(['UPDATE_SIGNING_KEY']);
    expect(await importedPublicKeys()).toEqual([publicKeyOf(privateKey)]);
  });

  it('개인 키는 화면에 내지 않고 클립보드에만 복사했다가, 비밀번호 관리자에 넣었다는 Enter 뒤에 클립보드를 비운다', async () => {
    const { ports, secrets, printed, clipboard } = fakePorts();

    await runKeygen({ rotate: false, publicKeys: [], publicKeysFile: publicKeysFile() }, ports);

    /** 등록한 개인 키. */
    const privateKey = secrets.get('UPDATE_SIGNING_KEY') ?? '';
    expect(clipboard.whileWaiting).toBe(privateKey);
    expect(clipboard.now).toBe('');
    expect(printed.join('\n')).not.toContain(privateKey);
    expect(printed.join('\n')).toContain('비밀번호 관리자');
  });

  it('Enter 대신 중단하면 클립보드를 비우고 공개 키 목록 파일은 쓰지 않는다', async () => {
    const { ports, clipboard } = fakePorts({ interrupt: true });

    await expect(runKeygen({ rotate: false, publicKeys: [], publicKeysFile: publicKeysFile() }, ports)).rejects.toThrow();

    expect(clipboard.now).toBe('');
    expect(await importedPublicKeys()).toBeNull();
  });

  it('비밀값 등록이 실패하면 클립보드에 넣지 않고 공개 키 목록 파일도 쓰지 않는다', async () => {
    const { ports, clipboard } = fakePorts({ failSecret: true });

    await expect(runKeygen({ rotate: false, publicKeys: [], publicKeysFile: publicKeysFile() }, ports)).rejects.toThrow(
      /gh secret set/,
    );

    expect(clipboard.whileWaiting).toBeNull();
    expect(clipboard.now).toBe('');
    expect(await importedPublicKeys()).toBeNull();
  });

  it('목록에 이미 키가 있으면 --rotate 없이는 새 키를 만들지 않는다(설치된 앱이 업데이트를 받지 못하게 되므로)', async () => {
    const { ports, secrets } = fakePorts();
    /** 이미 쓰는 키. */
    const existing = generateSigningKeyPair().publicKey;

    await expect(
      runKeygen({ rotate: false, publicKeys: [existing], publicKeysFile: publicKeysFile() }, ports),
    ).rejects.toThrow(/--rotate/);

    expect(secrets.size).toBe(0);
    expect(await importedPublicKeys()).toBeNull();
  });
});

describe('업데이트 서명 키 회전(--rotate)', () => {
  it('새 공개 키를 목록 뒤에 더하고, 새 개인 키를 둘째 비밀값 UPDATE_SIGNING_KEY_2로 등록한다', async () => {
    const { ports, secrets } = fakePorts();
    /** 지금 쓰는 키. */
    const existing = generateSigningKeyPair().publicKey;

    await runKeygen({ rotate: true, publicKeys: [existing], publicKeysFile: publicKeysFile() }, ports);

    /** 등록한 새 개인 키. */
    const privateKey = secrets.get('UPDATE_SIGNING_KEY_2') ?? '';
    expect([...secrets.keys()]).toEqual(['UPDATE_SIGNING_KEY_2']);
    expect(await importedPublicKeys()).toEqual([existing, publicKeyOf(privateKey)]);
  });

  it('아직 키가 없으면 회전하지 않는다', async () => {
    const { ports, secrets } = fakePorts();

    await expect(runKeygen({ rotate: true, publicKeys: [], publicKeysFile: publicKeysFile() }, ports)).rejects.toThrow(
      /--rotate 없이/,
    );

    expect(secrets.size).toBe(0);
  });

  it('이미 회전 중이면(공개 키 둘) 옛 키를 빼기 전에는 다시 회전하지 않는다', async () => {
    const { ports, secrets } = fakePorts();
    /** 회전 중인 두 키. */
    const publicKeys = [generateSigningKeyPair().publicKey, generateSigningKeyPair().publicKey];

    await expect(runKeygen({ rotate: true, publicKeys, publicKeysFile: publicKeysFile() }, ports)).rejects.toThrow(
      /옛 키/,
    );

    expect(secrets.size).toBe(0);
  });
});

describe('앱 소스의 공개 키 목록 파일', () => {
  it('release:keygen이 쓰는 모양 그대로라서, 다음 키 생성이 손으로 고친 내용을 조용히 덮어쓰지 않는다', async () => {
    /** 커밋된 공개 키 목록 파일. */
    const committed = await readFile(new URL('../src/core/update/update-public-keys.mts', import.meta.url), 'utf8');

    expect(committed).toBe(renderPublicKeysModule(UPDATE_PUBLIC_KEYS));
  });
});
