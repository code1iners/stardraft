import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeClock } from '../fakes/fake-clock';
import { FakeEncryption } from '../fakes/fake-encryption';
import { createLogger } from '../logging/logger';
import { FileSecretStore } from './file-secret-store';

/** 테스트마다 만드는 임시 데이터 폴더. */
let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'stardraft-secret-'));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

/** 아무 데도 남기지 않는 로거. */
const silentLogger = createLogger([], new FakeClock());

/** 키 파일 경로. */
const keyPath = () => join(dataDir, 'flow-api-key.bin');

/** 임시 폴더의 키 파일을 쓰는 비밀 저장소. */
function createStore(encryption = new FakeEncryption()): FileSecretStore {
  return new FileSecretStore(keyPath(), encryption, silentLogger);
}

describe('Flow 개인 API 키 보관', () => {
  it('저장한 키를 다시 읽으면 같은 키가 나오고, 파일에는 암호문만 남는다', async () => {
    const store = createStore();

    await store.writeFlowApiKey('fake-key-1');

    await expect(store.readFlowApiKey()).resolves.toEqual({ kind: 'found', value: 'fake-key-1' });
    expect(readFileSync(keyPath()).includes(Buffer.from('fake-key-1'))).toBe(false);
  });

  it('저장한 키가 없거나 지운 뒤에는 키가 없다고 돌려준다', async () => {
    const store = createStore();

    await expect(store.readFlowApiKey()).resolves.toEqual({ kind: 'missing' });
    await store.writeFlowApiKey('fake-key-1');
    await store.deleteFlowApiKey();
    await expect(store.readFlowApiKey()).resolves.toEqual({ kind: 'missing' });
    await store.deleteFlowApiKey();
  });

  it('저장된 키를 풀 수 없으면(키체인 거부, 항목 삭제, 다른 PC로 복사) 읽을 수 없다고 돌려준다', async () => {
    const encryption = new FakeEncryption();
    const store = createStore(encryption);
    await store.writeFlowApiKey('fake-key-1');

    encryption.failDecrypt = true;

    await expect(store.readFlowApiKey()).resolves.toEqual({ kind: 'unreadable' });
  });

  it('열쇠가 바뀌어 다시 암호화하라고 하면(shouldReEncrypt) 새 열쇠로 암호화해 다시 저장한다', async () => {
    const encryption = new FakeEncryption();
    const store = createStore(encryption);
    await store.writeFlowApiKey('fake-key-1');
    /** 옛 열쇠로 만든 암호문. */
    const before = readFileSync(keyPath());

    encryption.keyVersion = 2;

    await expect(store.readFlowApiKey()).resolves.toEqual({ kind: 'found', value: 'fake-key-1' });
    expect(readFileSync(keyPath()).equals(before)).toBe(false);
    await expect(encryption.decryptStringAsync(readFileSync(keyPath()))).resolves.toEqual({
      shouldReEncrypt: false,
      result: 'fake-key-1',
    });
  });

  it('다시 암호화하지 못해도 이번에 푼 키는 돌려주고 옛 암호문을 그대로 둔다', async () => {
    const encryption = new FakeEncryption();
    const store = createStore(encryption);
    await store.writeFlowApiKey('fake-key-1');
    /** 옛 열쇠로 만든 암호문. */
    const before = readFileSync(keyPath());
    encryption.keyVersion = 2;
    encryption.failEncrypt = true;

    await expect(store.readFlowApiKey()).resolves.toEqual({ kind: 'found', value: 'fake-key-1' });
    expect(readFileSync(keyPath()).equals(before)).toBe(true);
  });

  it('새 키를 암호화하지 못하면 저장이 실패하고 옛 키를 그대로 둔다', async () => {
    const encryption = new FakeEncryption();
    const store = createStore(encryption);
    await store.writeFlowApiKey('fake-key-old');
    encryption.failEncrypt = true;

    await expect(store.writeFlowApiKey('fake-key-new')).rejects.toThrow();

    encryption.failEncrypt = false;
    await expect(store.readFlowApiKey()).resolves.toEqual({ kind: 'found', value: 'fake-key-old' });
  });

  it('옛 키를 다시 암호화하는 도중 새 키를 저장해도 새 키가 남는다', async () => {
    const encryption = new FakeEncryption();
    const store = createStore(encryption);
    await store.writeFlowApiKey('fake-key-old');
    encryption.keyVersion = 2;
    /** 복호화를 붙잡아 두는 문을 여는 함수. */
    let openGate = () => {};
    encryption.decryptGate = new Promise((resolve) => {
      openGate = resolve;
    });

    /** 옛 키를 풀어 다시 암호화할 읽기. */
    const reading = store.readFlowApiKey();
    /** 그 사이에 들어온 새 키 저장. */
    const writing = store.writeFlowApiKey('fake-key-new');
    openGate();
    await Promise.all([reading, writing]);

    encryption.decryptGate = null;
    await expect(store.readFlowApiKey()).resolves.toEqual({ kind: 'found', value: 'fake-key-new' });
  });

  it('키 파일 자리를 읽을 수 없어도 읽을 수 없다고 돌려준다', async () => {
    mkdirSync(keyPath());

    await expect(createStore().readFlowApiKey()).resolves.toEqual({ kind: 'unreadable' });
  });
});
