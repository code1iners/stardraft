import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeClock } from '../fakes/fake-clock';
import { FakeUpdateFeed, type FakeUpdateRelease } from '../fakes/fake-update-feed';
import { MemoryStateStore } from '../fakes/memory-state-store';
import { createLogger } from '../logging/logger';
import { InAppUpdate, type UpdateStatus } from './in-app-update';
import type { BlockedLocationReason } from './install-location';
import { generateSigningKeyPair, SIGNATURES_FIELD, signUpdateFile, type SignedFile, type SigningKeyPair } from './update-signature.mts';

/** 지금 시각. 2026-10-22 10:00:00 한국 표준시(01:00:00 UTC). */
const NOW = Date.UTC(2026, 9, 22, 1, 0, 0);
/** 1분(밀리초). */
const MINUTE_MS = 60_000;
/** 1시간(밀리초). */
const HOUR_MS = 60 * MINUTE_MS;
/** 지금 앱 버전. */
const CURRENT_VERSION = '0.1.0';
/** 앱 소스의 공개 키 목록에 든 가짜 서명 키. */
const APP_KEY = generateSigningKeyPair();
/** 앱이 모르는 가짜 서명 키. */
const OTHER_KEY = generateSigningKeyPair();

/** 테스트마다 만드는 임시 폴더. 가짜 피드가 받은 파일을 여기에 쓴다. */
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'stardraft-update-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** 내용의 sha512. latest*.yml처럼 base64다. */
function sha512Of(content: string): string {
  return createHash('sha512').update(content).digest('base64');
}

/** 가짜 Release를 만드는 방법. 주지 않은 것은 태그 워크플로가 만드는 그대로다. */
interface ReleaseOptions {
  /** 업데이트 파일 이름. 기본은 Apple Silicon zip 이름이다. */
  fileName?: string;
  /** 받을 파일의 내용. */
  content?: string;
  /** 서명 목록의 서명을 만들 키. 기본은 앱의 공개 키 목록에 든 키 하나다. */
  signingKeys?: SigningKeyPair[];
  /** 서명 문장에 넣을 값. 주면 실제 값 대신 이 값으로 서명한다. */
  signedAs?: Partial<SignedFile>;
  /** 서명 목록 필드에 서명 대신 넣을 값. `undefined`를 주면 필드를 뺀다. */
  signaturesField?: unknown;
  /** 받은 파일의 이름. 주지 않으면 안내 파일 항목의 `url`이다. */
  downloadedAs?: string;
  /** 실제로 받은 파일의 내용. 주지 않으면 안내에 적은 파일 그대로다. */
  downloadedContent?: string;
}

/**
 * 태그 워크플로가 서명한 것 같은 가짜 macOS Release. 안내에는 실제 파일의 이름·크기·sha512를 적고,
 * 서명 문장(형식 이름·버전·파일 이름·sha512)에 서명해 파일 항목의 서명 목록 필드에 넣는다.
 */
function signedRelease(version: string, options: ReleaseOptions = {}): FakeUpdateRelease {
  /** 업데이트 파일 이름. */
  const fileName = options.fileName ?? `Stardraft-${version}-arm64-mac.zip`;
  /** 받을 파일의 내용. */
  const content = options.content ?? `가짜 업데이트 zip ${version}`;
  /** 실제 파일의 sha512. electron-updater가 받으며 확인하는 값이라 안내에는 늘 이 값이 있다. */
  const sha512 = sha512Of(content);
  /** 서명한 값. */
  const signed: SignedFile = { version, fileName, sha512, ...options.signedAs };
  /** 파일 항목. */
  const entry: Record<string, unknown> = { url: fileName, sha512, size: Buffer.byteLength(content) };
  if (!('signaturesField' in options)) {
    entry[SIGNATURES_FIELD] = (options.signingKeys ?? [APP_KEY]).map((key) => signUpdateFile(signed, key.privateKey));
  } else if (options.signaturesField !== undefined) {
    entry[SIGNATURES_FIELD] = options.signaturesField;
  }
  return { manifest: { version, files: [entry] }, fileName: options.downloadedAs ?? fileName, content: options.downloadedContent ?? content };
}

/** 서명 하나를 한 글자 바꾼다. 여전히 64바이트 base64라 형식 검사는 통과한다. */
function tamper(signature: string): string {
  return `${signature.slice(0, 10)}${signature[10] === 'A' ? 'B' : 'A'}${signature.slice(11)}`;
}

/** 앱의 키로 바르게 만든 Release의 서명 목록. */
function validSignaturesOf(version: string): string[] {
  return Reflect.get(signedRelease(version).manifest.files[0] as object, SIGNATURES_FIELD) as string[];
}

/**
 * 가짜 피드와 가짜 시계로 앱 내 업데이트를 만든다. 공개 키 목록은 앱의 키 하나다.
 * `stateStore`를 넘기면 그 상태 저장소를 쓴다. 같은 저장소로 다시 만들면 앱을 다시 켠 것과 같다.
 */
function setup(release: FakeUpdateRelease | null, stateStore = new MemoryStateStore()) {
  const clock = new FakeClock(NOW);
  const feed = new FakeUpdateFeed(dir);
  feed.latest = release;
  /** 앱이 놓인 곳. `blocked`가 있으면 앱이 스스로 바꿀 수 없는 위치다. 테스트가 바꾼다. */
  const place: { blocked: BlockedLocationReason | null } = { blocked: null };
  const update = new InAppUpdate({
    feed,
    currentVersion: CURRENT_VERSION,
    publicKeys: [APP_KEY.publicKey],
    checkLocation: async () => place.blocked,
    stateStore,
    clock,
    logger: createLogger([{ write: () => {} }], clock),
  });
  return { clock, feed, update, stateStore, place };
}

/** 앱을 켜고 1분 뒤의 첫 확인을 마친다. */
async function startAndCheck({ clock, update }: Pick<ReturnType<typeof setup>, 'clock' | 'update'>): Promise<void> {
  update.start();
  clock.advance(MINUTE_MS);
  await update.whenIdle();
}

describe('받은 업데이트 파일의 서명 검증', () => {
  it('켜고 1분 뒤 확인해 서명이 맞는 새 버전을 찾으면 묻지 않고 받아 설치 준비됨이 된다', async () => {
    const context = setup(signedRelease('0.2.0'));

    await startAndCheck(context);

    expect(context.update.state()).toEqual({ kind: 'ready', version: '0.2.0' });
  });

  it.each<[string, () => FakeUpdateRelease]>([
    // electron-updater의 sha512 확인을 통과하도록 안내의 sha512도 바꾼 파일에 맞춰 고친 경우다.
    [
      '파일을 바꿔치고 안내의 sha512도 고쳤으면(sha512 변조)',
      () => signedRelease('0.2.0', { content: '바꿔치기한 zip', signedAs: { sha512: sha512Of('가짜 업데이트 zip 0.2.0') } }),
    ],
    ['안내와 서명은 그대로인데 받은 파일의 내용이 다르면(sha512 변조)', () => signedRelease('0.2.0', { downloadedContent: '바꿔치기한 zip' })],
    ['서명을 한 글자 바꿨으면(서명 변조)', () => signedRelease('0.2.0', { signaturesField: validSignaturesOf('0.2.0').map(tamper) })],
    ['앱의 공개 키 목록에 없는 키로 서명했으면(서명 변조)', () => signedRelease('0.2.0', { signingKeys: [OTHER_KEY] })],
    ['안내의 버전이 서명한 버전과 다르면(버전 불일치)', () => signedRelease('0.3.0', { signedAs: { version: '0.2.0' } })],
    ['서명한 버전이 지금 버전과 같으면', () => signedRelease(CURRENT_VERSION)],
    ['서명한 버전이 지금 버전보다 낮으면', () => signedRelease('0.0.9')],
    ['서명한 파일 이름이 받은 파일과 다르면(이름 불일치)', () => signedRelease('0.2.0', { signedAs: { fileName: 'Stardraft-0.2.0-x64-mac.zip' } })],
    ['받은 파일 이름의 파일 항목이 없으면(이름 불일치)', () => signedRelease('0.2.0', { downloadedAs: 'Stardraft-0.2.0-arm64-mac-copy.zip' })],
    ['서명 목록 필드가 없으면', () => signedRelease('0.2.0', { signaturesField: undefined })],
    ['서명 목록이 비었으면', () => signedRelease('0.2.0', { signaturesField: [] })],
    ['서명 목록이 목록이 아니면', () => signedRelease('0.2.0', { signaturesField: validSignaturesOf('0.2.0')[0] })],
    ['서명 목록에 서명이 아닌 값이 섞였으면', () => signedRelease('0.2.0', { signaturesField: [...validSignaturesOf('0.2.0'), 'not a signature'] })],
  ])('%s 받은 파일을 지우고 서명 검증 실패가 된다', async (_case, makeRelease) => {
    /** 확인에서 찾을 Release. */
    const release = makeRelease();
    const context = setup(release);

    await startAndCheck(context);

    expect(context.update.state()).toEqual({ kind: 'signature-failed', version: release.manifest.version });
    expect(context.feed.downloads).toHaveLength(1);
    expect(context.feed.downloads.filter((file) => existsSync(file))).toEqual([]);
  });

  it('안내에 파일 항목이 여럿이면 받은 파일의 항목에 든 서명으로 검증한다', async () => {
    /** 같은 버전의 Intel zip. 이 PC는 받지 않는다. */
    const intel = signedRelease('0.2.0', { fileName: 'Stardraft-0.2.0-mac.zip', content: '가짜 Intel zip' });
    /** 이 PC가 받는 Apple Silicon zip. */
    const arm64 = signedRelease('0.2.0');
    const context = setup({ ...arm64, manifest: { version: '0.2.0', files: [...intel.manifest.files, ...arm64.manifest.files] } });

    await startAndCheck(context);

    expect(context.update.state()).toEqual({ kind: 'ready', version: '0.2.0' });
  });

  it('키를 회전하는 동안 두 키로 서명했으면 앱이 아는 키의 서명 하나로 통과한다', async () => {
    const context = setup(signedRelease('0.2.0', { signingKeys: [OTHER_KEY, APP_KEY] }));

    await startAndCheck(context);

    expect(context.update.state()).toEqual({ kind: 'ready', version: '0.2.0' });
    expect(context.feed.downloads.filter((file) => existsSync(file))).toHaveLength(1);
  });
});

describe('확인 시점', () => {
  it('켜고 1분 뒤 처음 확인하고, 그 뒤 4시간마다 확인한다', async () => {
    const { clock, feed, update } = setup(null);

    update.start();
    clock.advance(MINUTE_MS - 1);
    await update.whenIdle();
    expect(feed.checkCount).toBe(0);

    clock.advance(1);
    await update.whenIdle();
    expect(feed.checkCount).toBe(1);

    clock.advance(4 * HOUR_MS - 1);
    await update.whenIdle();
    expect(feed.checkCount).toBe(1);

    clock.advance(1);
    await update.whenIdle();
    expect(feed.checkCount).toBe(2);
  });

  it('[지금 확인]은 바로 확인하고, 다음 정해진 확인은 그때부터 4시간 뒤다', async () => {
    const context = setup(null);
    await startAndCheck(context);
    context.clock.advance(HOUR_MS);

    await context.update.checkNow();
    expect(context.feed.checkCount).toBe(2);
    expect(context.update.state()).toEqual({ kind: 'up-to-date', checkedAt: NOW + MINUTE_MS + HOUR_MS });

    context.clock.advance(4 * HOUR_MS - 1);
    await context.update.whenIdle();
    expect(context.feed.checkCount).toBe(2);
    context.clock.advance(1);
    await context.update.whenIdle();
    expect(context.feed.checkCount).toBe(3);
  });

  it('[지금 확인]을 누르면 확인하는 동안 확인 중을 보인다', async () => {
    const context = setup(null);
    await startAndCheck(context);
    /** 알린 상태. */
    const seen: UpdateStatus[] = [];
    context.update.onChange((status) => seen.push(status));

    await context.update.checkNow();

    expect(seen).toEqual([{ kind: 'checking' }, { kind: 'up-to-date', checkedAt: NOW + MINUTE_MS }]);
  });

  it('잠자기에서 깨어났을 때 마지막 확인이 4시간보다 오래됐으면 바로 확인한다', async () => {
    const context = setup(null);
    await startAndCheck(context);
    context.clock.advance(HOUR_MS);
    // 잠든 동안 타이머는 멈춰 있어, 깨어난 때에는 정해진 확인이 아직 오지 않았다.
    context.clock.sleep(3 * HOUR_MS);

    await context.update.checkIfDue();

    expect(context.feed.checkCount).toBe(2);
  });

  it('잠자기에서 깨어났을 때 마지막 확인이 4시간이 안 됐으면 확인하지 않는다', async () => {
    const context = setup(null);
    await startAndCheck(context);
    context.clock.sleep(4 * HOUR_MS - 1);

    await context.update.checkIfDue();

    expect(context.feed.checkCount).toBe(1);
  });

  it('잠자기에서 깨어났을 때 마지막 확인이 4시간이 안 됐으면, 다음 확인은 잠든 시간만큼 밀리지 않고 마지막 확인에서 4시간 뒤다', async () => {
    const context = setup(null);
    await startAndCheck(context);
    context.clock.advance(HOUR_MS);
    context.clock.sleep(2 * HOUR_MS);
    await context.update.checkIfDue();
    expect(context.feed.checkCount).toBe(1);

    context.clock.advance(HOUR_MS - 1);
    await context.update.whenIdle();
    expect(context.feed.checkCount).toBe(1);
    context.clock.advance(1);
    await context.update.whenIdle();
    expect(context.feed.checkCount).toBe(2);
  });

  it('켜고 첫 확인 전에 잠들었다 깨어나면 바로 확인한다', async () => {
    const context = setup(null);
    context.update.start();
    context.clock.sleep(2 * HOUR_MS);

    await context.update.checkIfDue();

    expect(context.feed.checkCount).toBe(1);
  });

  it('끄면 진행 중인 확인은 마치되 다음 확인은 하지 않는다', async () => {
    const context = setup(null);
    context.update.start();
    context.clock.advance(MINUTE_MS);
    context.update.stop();
    await context.update.whenIdle();

    context.clock.advance(5 * HOUR_MS);
    await context.update.whenIdle();

    expect(context.feed.checkCount).toBe(1);
  });

  it('새 버전이 없으면 최신 버전이고, 마지막으로 확인한 시각을 남긴다', async () => {
    const context = setup(null);

    await startAndCheck(context);

    expect(context.update.state()).toEqual({ kind: 'up-to-date', checkedAt: NOW + MINUTE_MS });
  });
});

describe('서명 검증 실패 뒤', () => {
  /** 앱이 모르는 키로 서명해 검증에 실패하는 0.2.0 Release. */
  const badRelease = () => signedRelease('0.2.0', { signingKeys: [OTHER_KEY] });

  /** 켜고 1분 뒤 첫 확인에서 서명 검증에 실패한 앱 내 업데이트. */
  async function failedOnce() {
    const context = setup(badRelease());
    await startAndCheck(context);
    expect(context.update.state()).toEqual({ kind: 'signature-failed', version: '0.2.0' });
    return context;
  }

  it('같은 버전은 다음 확인에서 자동으로 다시 받지 않고 서명 검증 실패를 그대로 보인다', async () => {
    const { clock, feed, update } = await failedOnce();

    clock.advance(4 * HOUR_MS);
    await update.whenIdle();

    expect(feed.checkCount).toBe(2);
    expect(feed.downloads).toHaveLength(1);
    expect(update.state()).toEqual({ kind: 'signature-failed', version: '0.2.0' });
  });

  it('더 새 버전이 나오면 그 버전은 받는다', async () => {
    const { clock, feed, update } = await failedOnce();
    feed.latest = signedRelease('0.3.0');

    clock.advance(4 * HOUR_MS);
    await update.whenIdle();

    expect(feed.downloads).toHaveLength(2);
    expect(update.state()).toEqual({ kind: 'ready', version: '0.3.0' });
  });

  it('[다시 시도]를 누르면 같은 버전을 다시 받아 다시 검증한다', async () => {
    const { feed, update } = await failedOnce();

    await update.retry();

    expect(feed.downloads).toHaveLength(2);
    expect(feed.downloads.filter((file) => existsSync(file))).toEqual([]);
    expect(update.state()).toEqual({ kind: 'signature-failed', version: '0.2.0' });
  });

  it('[다시 시도]를 누를 때 진행 중이던 확인이 끝나자마자 다른 확인이 이어져도, 그 확인까지 끝난 뒤 같은 버전을 다시 받는다', async () => {
    const { feed, update } = await failedOnce();
    void update.checkNow();
    // 진행 중이던 확인이 끝나자마자 다른 확인을 시작한다. [다시 시도]보다 먼저 이어 붙인다.
    void update.whenIdle().then(() => update.checkNow());

    await update.retry();

    expect(feed.downloads).toHaveLength(2);
    expect(update.state()).toEqual({ kind: 'signature-failed', version: '0.2.0' });
  });

  it('다음 확인을 하지 못해도 서명 검증 실패를 그대로 보인다', async () => {
    const { clock, feed, update } = await failedOnce();
    feed.checkError = new Error('getaddrinfo ENOTFOUND github.com');

    clock.advance(4 * HOUR_MS);
    await update.whenIdle();

    expect(update.state()).toEqual({ kind: 'signature-failed', version: '0.2.0' });
  });

  it('앱을 다시 켜도 같은 버전은 자동으로 다시 받지 않는다', async () => {
    const { stateStore } = await failedOnce();

    /** 같은 state.db로 다시 켠 앱. */
    const restarted = setup(badRelease(), stateStore);
    await startAndCheck(restarted);

    expect(restarted.feed.downloads).toEqual([]);
    expect(restarted.update.state()).toEqual({ kind: 'signature-failed', version: '0.2.0' });
  });

  it('[다시 시도]로 받은 같은 버전이 검증을 통과하면, 다시 켠 뒤에는 그 버전을 실패한 버전으로 보지 않는다', async () => {
    const { feed, update, stateStore } = await failedOnce();
    feed.latest = signedRelease('0.2.0');

    await update.retry();
    expect(update.state()).toEqual({ kind: 'ready', version: '0.2.0' });

    /** 같은 state.db로 다시 켠 앱. */
    const restarted = setup(signedRelease('0.2.0'), stateStore);
    await startAndCheck(restarted);

    expect(restarted.feed.downloads).toHaveLength(1);
    expect(restarted.update.state()).toEqual({ kind: 'ready', version: '0.2.0' });
  });
});

describe('확인·다운로드 실패', () => {
  it('확인하지 못하면 확인 실패와 그 시각을 남기고, 다음 확인에서 저절로 다시 시도한다', async () => {
    const context = setup(signedRelease('0.2.0'));
    context.feed.checkError = new Error('getaddrinfo ENOTFOUND github.com');

    await startAndCheck(context);
    expect(context.update.state()).toEqual({ kind: 'check-failed', failedAt: NOW + MINUTE_MS });

    context.feed.checkError = null;
    context.clock.advance(4 * HOUR_MS);
    await context.update.whenIdle();
    expect(context.update.state()).toEqual({ kind: 'ready', version: '0.2.0' });
  });

  it('받지 못하면(네트워크 오류, electron-updater의 sha512 불일치) 확인 실패가 되고, 다음 확인에서 같은 버전을 다시 받는다', async () => {
    const context = setup(signedRelease('0.2.0'));
    context.feed.downloadError = new Error('sha512 checksum mismatch');

    await startAndCheck(context);
    expect(context.update.state()).toEqual({ kind: 'check-failed', failedAt: NOW + MINUTE_MS });

    context.feed.downloadError = null;
    context.clock.advance(4 * HOUR_MS);
    await context.update.whenIdle();
    expect(context.update.state()).toEqual({ kind: 'ready', version: '0.2.0' });
  });
});

describe('상태 알림', () => {
  it('확인 중, 받는 중과 받은 비율, 설치 준비됨을 차례로 알린다. 받은 비율은 정수 %가 바뀔 때만 알린다', async () => {
    const context = setup(signedRelease('0.2.0'));
    context.feed.progress = [0, 45.2, 45.8, 100];
    /** 알린 상태. 알린 순서다. */
    const seen: UpdateStatus[] = [];
    context.update.onChange((status) => seen.push(status));

    await startAndCheck(context);

    expect(seen).toEqual([
      { kind: 'checking' },
      { kind: 'downloading', version: '0.2.0', percent: 0 },
      { kind: 'downloading', version: '0.2.0', percent: 45 },
      { kind: 'downloading', version: '0.2.0', percent: 100 },
      { kind: 'ready', version: '0.2.0' },
    ]);
  });
});

describe('설치 준비됨 뒤의 확인', () => {
  /** 켜고 1분 뒤 첫 확인에서 0.2.0을 받아 설치 준비됨이 된 앱 내 업데이트와, 그 뒤 알린 상태. */
  async function readyOnce() {
    const context = setup(signedRelease('0.2.0'));
    await startAndCheck(context);
    expect(context.update.state()).toEqual({ kind: 'ready', version: '0.2.0' });
    /** 설치 준비됨 뒤에 알린 상태. */
    const seen: UpdateStatus[] = [];
    context.update.onChange((status) => seen.push(status));
    return { ...context, seen };
  }

  it('다음 확인이 같은 버전을 찾으면 다시 받지 않고, 확인하는 동안에도 설치 준비됨을 지킨다', async () => {
    const { clock, feed, update, seen } = await readyOnce();

    clock.advance(4 * HOUR_MS);
    await update.whenIdle();

    expect(feed.checkCount).toBe(2);
    expect(feed.downloads).toHaveLength(1);
    expect(seen).toEqual([]);
  });

  it('[지금 확인]으로 확인해도 같은 버전이면 다시 받지 않고 설치 준비됨으로 돌아온다', async () => {
    const { feed, update } = await readyOnce();

    await update.checkNow();

    expect(feed.downloads).toHaveLength(1);
    expect(update.state()).toEqual({ kind: 'ready', version: '0.2.0' });
  });

  it('확인하지 못해도 설치 준비됨을 지킨다', async () => {
    const { clock, feed, update, seen } = await readyOnce();
    feed.checkError = new Error('getaddrinfo ENOTFOUND github.com');

    clock.advance(4 * HOUR_MS);
    await update.whenIdle();

    expect(seen).toEqual([]);
  });

  it('잘못 나간 버전을 사전 릴리스로 바꿔 새 버전이 없어지면 최신 버전이 된다', async () => {
    const { clock, feed, update } = await readyOnce();
    feed.latest = null;

    clock.advance(4 * HOUR_MS);
    await update.whenIdle();

    expect(update.state()).toEqual({ kind: 'up-to-date', checkedAt: NOW + MINUTE_MS + 4 * HOUR_MS });
  });

  it('더 새 버전이 나오면 그 버전을 받는다', async () => {
    const { clock, feed, update, seen } = await readyOnce();
    feed.latest = signedRelease('0.3.0');

    clock.advance(4 * HOUR_MS);
    await update.whenIdle();

    expect(seen).toEqual([
      { kind: 'downloading', version: '0.3.0', percent: 0 },
      { kind: 'ready', version: '0.3.0' },
    ]);
  });
});

describe('앱이 스스로 바꿀 수 없는 위치', () => {
  it.each<[string, BlockedLocationReason]>([
    ['읽기 전용 볼륨(DMG 안, App Translocation)', 'read-only'],
    ['번들이나 부모 폴더에 쓸 권한이 없는 곳', 'no-permission'],
  ])('%s이면 새 버전을 받지 않고, 새 버전과 그 까닭만 보인다', async (_case, reason) => {
    const context = setup(signedRelease('0.2.0'));
    context.place.blocked = reason;

    await startAndCheck(context);

    expect(context.feed.downloads).toEqual([]);
    expect(context.update.state()).toEqual({ kind: 'location-blocked', version: '0.2.0', reason });
  });

  it('확인할 때마다 위치를 다시 보고, 바꿀 수 있는 곳이 되면 받는다', async () => {
    const context = setup(signedRelease('0.2.0'));
    context.place.blocked = 'read-only';
    await startAndCheck(context);

    context.place.blocked = null;
    context.clock.advance(4 * HOUR_MS);
    await context.update.whenIdle();

    expect(context.update.state()).toEqual({ kind: 'ready', version: '0.2.0' });
  });

  it('다음 확인을 하지 못해도 새 버전과 그 까닭을 그대로 보인다', async () => {
    const context = setup(signedRelease('0.2.0'));
    context.place.blocked = 'no-permission';
    await startAndCheck(context);

    context.feed.checkError = new Error('getaddrinfo ENOTFOUND github.com');
    context.clock.advance(4 * HOUR_MS);
    await context.update.whenIdle();

    expect(context.update.state()).toEqual({ kind: 'location-blocked', version: '0.2.0', reason: 'no-permission' });
  });
});
