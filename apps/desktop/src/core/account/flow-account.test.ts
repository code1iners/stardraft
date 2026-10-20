import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeClock } from '../fakes/fake-clock';
import { FakeEncryption } from '../fakes/fake-encryption';
import { FAKE_ME } from '../fakes/fake-flow-api';
import { FakeFlowServer } from '../fakes/fake-flow-server';
import { HttpFlowApi } from '../flow/http-flow-api';
import { createLogger } from '../logging/logger';
import type { FlowEmployee } from '../ports/flow-api';
import { DEFAULT_SETTINGS, type Settings } from '../ports/settings-store';
import { openAppData, type AppData } from '../storage/app-data';
import { FlowAccount } from './flow-account';

/** 테스트마다 만드는 임시 데이터 폴더. */
let dataDir: string;
/** 테스트가 연 데이터. 끝나면 닫는다. */
let opened: AppData | null = null;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'stardraft-account-'));
});

afterEach(() => {
  opened?.close();
  opened = null;
  rmSync(dataDir, { recursive: true, force: true });
});

/** 아무 데도 남기지 않는 로거. */
const silentLogger = createLogger([], new FakeClock());

/** 다른 사람의 가짜 계정. */
const OTHER: FlowEmployee = { userId: 'other@example.test', name: '다른 사용자', division: '다른 팀', email: 'other@example.test' };

/** 임시 데이터 폴더, 가짜 Flow 서버, 가짜 시계로 Flow 계정을 연다. 같은 데이터 폴더로 다시 부르면 앱을 다시 켠 것과 같다. */
async function setup() {
  const clock = new FakeClock(Date.UTC(2026, 9, 20, 9, 0, 0));
  const server = new FakeFlowServer();
  const encryption = new FakeEncryption();
  opened?.close();
  /** 형식 검사를 마친 데이터 폴더. */
  const result = await openAppData({ dataDir, appVersion: '0.1.0', logger: silentLogger, encryption });
  if (result.kind !== 'ready') throw new Error(result.message);
  opened = result;

  const flowAccount = new FlowAccount({
    connectFlow: (apiKey) => new HttpFlowApi({ apiKey, fetch: server.fetch, clock }),
    secretStore: result.secretStore,
    stateStore: result.stateStore,
    clock,
    logger: silentLogger,
  });
  await flowAccount.load();
  return { clock, server, encryption, data: result, flowAccount };
}

describe('Flow 계정 연결', () => {
  it('처음 키를 확인하면 계정을 연결하고, 붙여 넣은 앞뒤 공백을 뺀 키를 암호화해 저장한다', async () => {
    const { server, data, flowAccount } = await setup();
    server.addAccount('fake-key-1', FAKE_ME);

    const outcome = await flowAccount.checkKey('  fake-key-1\n');

    expect(outcome).toEqual({ kind: 'connected' });
    expect(flowAccount.state()).toEqual({ account: FAKE_ME, keyCheck: { status: 'idle' } });
    await expect(data.secretStore.readFlowApiKey()).resolves.toEqual({ kind: 'found', value: 'fake-key-1' });
    await expect(data.stateStore.getAccount()).resolves.toEqual(FAKE_ME);
  });

  it('앱을 다시 켜면 확인했던 계정이 연결된 계정으로 보인다', async () => {
    const first = await setup();
    first.server.addAccount('fake-key-1', FAKE_ME);
    await first.flowAccount.checkKey('fake-key-1');

    const second = await setup();

    expect(second.flowAccount.state()).toEqual({ account: FAKE_ME, keyCheck: { status: 'idle' } });
  });

  it('확인하는 동안 확인 중 상태를 알리고, 끝나면 연결된 계정을 알린다', async () => {
    const { server, flowAccount } = await setup();
    server.addAccount('fake-key-1', FAKE_ME);
    /** 알림으로 받은 상태. */
    const seen: unknown[] = [];
    flowAccount.onChange((state) => seen.push(state));

    await flowAccount.checkKey('fake-key-1');

    expect(seen).toEqual([
      { account: null, keyCheck: { status: 'checking' } },
      { account: FAKE_ME, keyCheck: { status: 'idle' } },
    ]);
  });

  it('Flow가 키를 거부하면(401) 키가 맞지 않다고 끝나고, 옛 키와 계정은 그대로 둔다', async () => {
    const { server, data, flowAccount } = await setup();
    server.addAccount('fake-key-1', FAKE_ME);
    await flowAccount.checkKey('fake-key-1');

    const outcome = await flowAccount.checkKey('fake-key-wrong');

    expect(outcome).toEqual({ kind: 'failed', reason: 'unauthorized' });
    expect(flowAccount.state()).toEqual({ account: FAKE_ME, keyCheck: { status: 'idle' } });
    await expect(data.secretStore.readFlowApiKey()).resolves.toEqual({ kind: 'found', value: 'fake-key-1' });
    await expect(data.stateStore.getAccount()).resolves.toEqual(FAKE_ME);
  });

  it('Flow에 연결할 수 없으면 연결 실패로 끝나고 아무것도 저장하지 않으며, 같은 키로 다시 시도하면 연결된다', async () => {
    const { server, data, flowAccount } = await setup();
    server.addAccount('fake-key-1', FAKE_ME);
    server.replyNext({ network: 'error' });

    await expect(flowAccount.checkKey('fake-key-1')).resolves.toEqual({ kind: 'failed', reason: 'network' });
    expect(flowAccount.state()).toEqual({ account: null, keyCheck: { status: 'idle' } });
    await expect(data.secretStore.readFlowApiKey()).resolves.toEqual({ kind: 'missing' });

    await expect(flowAccount.checkKey('fake-key-1')).resolves.toEqual({ kind: 'connected' });
    expect(flowAccount.state().account).toEqual(FAKE_ME);
  });

  it('요청 한도에 걸리면(429) Retry-After만큼 기다렸다가 자동으로 다시 확인한다', async () => {
    const { clock, server, flowAccount } = await setup();
    server.addAccount('fake-key-1', FAKE_ME);
    server.replyNext({ status: 429, headers: { 'retry-after': '3' } });

    /** 아직 끝나지 않은 키 확인. */
    const checking = flowAccount.checkKey('fake-key-1');
    await vi.waitFor(() => expect(flowAccount.state().keyCheck).toEqual({ status: 'waiting-retry' }));
    clock.advance(2_999);
    expect(server.requests).toHaveLength(1);
    clock.advance(1);

    await expect(checking).resolves.toEqual({ kind: 'connected' });
    expect(server.requests).toHaveLength(2);
    expect(flowAccount.state()).toEqual({ account: FAKE_ME, keyCheck: { status: 'idle' } });
  });

  it('한도가 풀리지 않으면 Retry-After가 없을 때 10초씩 세 번 다시 시도한 뒤 한도 실패로 끝난다', async () => {
    const { clock, server, data, flowAccount } = await setup();
    server.addAccount('fake-key-1', FAKE_ME);
    server.replyNext({ status: 429 }, { status: 429 }, { status: 429 }, { status: 429 });

    /** 아직 끝나지 않은 키 확인. */
    const checking = flowAccount.checkKey('fake-key-1');
    for (let retry = 1; retry <= 3; retry += 1) {
      await vi.waitFor(() => {
        expect(server.requests).toHaveLength(retry);
        expect(flowAccount.state().keyCheck).toEqual({ status: 'waiting-retry' });
      });
      clock.advance(10_000);
    }

    await expect(checking).resolves.toEqual({ kind: 'failed', reason: 'rate-limited' });
    expect(server.requests).toHaveLength(4);
    expect(flowAccount.state()).toEqual({ account: null, keyCheck: { status: 'idle' } });
    await expect(data.secretStore.readFlowApiKey()).resolves.toEqual({ kind: 'missing' });
  });

  it('Retry-After가 60초보다 길면 일찍 다시 부르지 않고 바로 한도 실패로 끝난다', async () => {
    const { server, flowAccount } = await setup();
    server.addAccount('fake-key-1', FAKE_ME);
    server.replyNext({ status: 429, headers: { 'retry-after': '61' } });

    await expect(flowAccount.checkKey('fake-key-1')).resolves.toEqual({ kind: 'failed', reason: 'rate-limited' });
    expect(server.requests).toHaveLength(1);
  });

  it('다시 확인을 기다리는 동안 취소하면 다시 확인하지 않고 아무것도 저장하지 않는다', async () => {
    const { clock, server, data, flowAccount } = await setup();
    server.addAccount('fake-key-1', FAKE_ME);
    server.replyNext({ status: 429, headers: { 'retry-after': '3' } });
    /** 아직 끝나지 않은 키 확인. */
    const checking = flowAccount.checkKey('fake-key-1');
    await vi.waitFor(() => expect(flowAccount.state().keyCheck).toEqual({ status: 'waiting-retry' }));

    flowAccount.cancelKeyCheck();

    await expect(checking).resolves.toEqual({ kind: 'cancelled' });
    clock.advance(60_000);
    expect(server.requests).toHaveLength(1);
    expect(flowAccount.state()).toEqual({ account: null, keyCheck: { status: 'idle' } });
    await expect(data.secretStore.readFlowApiKey()).resolves.toEqual({ kind: 'missing' });
  });

  it('확인 중에 다른 키를 확인하면 앞 확인은 나중에 응답이 와도 결과를 남기지 않는다', async () => {
    const { clock, server, data, flowAccount } = await setup();
    server.addAccount('fake-key-2', FAKE_ME);
    server.replyNext({ network: 'hang' });
    /** 응답을 기다리는 앞 확인. */
    const first = flowAccount.checkKey('fake-key-1');
    await vi.waitFor(() => expect(server.requests).toHaveLength(1));

    await expect(flowAccount.checkKey('fake-key-2')).resolves.toEqual({ kind: 'connected' });
    // 앞 요청이 제한 시간을 넘겨 연결 실패로 돌아온다.
    clock.advance(20_000);

    await expect(first).resolves.toEqual({ kind: 'cancelled' });
    expect(flowAccount.state()).toEqual({ account: FAKE_ME, keyCheck: { status: 'idle' } });
    await expect(data.secretStore.readFlowApiKey()).resolves.toEqual({ kind: 'found', value: 'fake-key-2' });
  });

  it('키를 OS 키 보관소로 암호화하지 못하면 저장 실패로 끝나고, 옛 키와 계정은 그대로 둔다', async () => {
    const { server, encryption, data, flowAccount } = await setup();
    server.addAccount('fake-key-1', FAKE_ME);
    server.addAccount('fake-key-2', FAKE_ME);
    await flowAccount.checkKey('fake-key-1');
    encryption.failEncrypt = true;

    await expect(flowAccount.checkKey('fake-key-2')).resolves.toEqual({ kind: 'failed', reason: 'save-failed' });

    expect(flowAccount.state()).toEqual({ account: FAKE_ME, keyCheck: { status: 'idle' } });
    await expect(data.secretStore.readFlowApiKey()).resolves.toEqual({ kind: 'found', value: 'fake-key-1' });
  });
});

describe('계정 비교', () => {
  it('같은 계정의 새 키면 묻지 않고 키만 바꾸며, 기준점 같은 상태는 그대로 둔다', async () => {
    const { server, data, flowAccount } = await setup();
    server.addAccount('fake-key-1', FAKE_ME);
    server.addAccount('fake-key-2', FAKE_ME);
    await flowAccount.checkKey('fake-key-1');
    await data.stateStore.setBaselineAlarmId('1001');

    await expect(flowAccount.checkKey('fake-key-2')).resolves.toEqual({ kind: 'connected' });

    expect(flowAccount.state()).toEqual({ account: FAKE_ME, keyCheck: { status: 'idle' } });
    await expect(data.secretStore.readFlowApiKey()).resolves.toEqual({ kind: 'found', value: 'fake-key-2' });
    await expect(data.stateStore.getBaselineAlarmId()).resolves.toBe('1001');
  });

  it('사용자 ID는 이메일 형식이라 대소문자만 다르면 같은 계정으로 보고 상태를 그대로 둔다', async () => {
    const { server, data, flowAccount } = await setup();
    server.addAccount('fake-key-1', FAKE_ME);
    server.addAccount('fake-key-2', { ...FAKE_ME, userId: 'Me@Example.TEST' });
    await flowAccount.checkKey('fake-key-1');
    await data.stateStore.setBaselineAlarmId('1001');

    await expect(flowAccount.checkKey('fake-key-2')).resolves.toEqual({ kind: 'connected' });

    await expect(data.stateStore.getBaselineAlarmId()).resolves.toBe('1001');
  });

  it('다른 계정의 키면 그 계정 이름으로 확인을 기다리고, 확인 전에는 옛 키와 계정, 상태를 바꾸지 않는다', async () => {
    const { server, data, flowAccount } = await setup();
    server.addAccount('fake-key-1', FAKE_ME);
    server.addAccount('fake-key-other', OTHER);
    await flowAccount.checkKey('fake-key-1');
    await data.stateStore.setBaselineAlarmId('1001');

    await expect(flowAccount.checkKey('fake-key-other')).resolves.toEqual({ kind: 'needs-confirmation', account: OTHER });

    expect(flowAccount.state()).toEqual({ account: FAKE_ME, keyCheck: { status: 'awaiting-confirmation', account: OTHER } });
    await expect(data.secretStore.readFlowApiKey()).resolves.toEqual({ kind: 'found', value: 'fake-key-1' });
    await expect(data.stateStore.getAccount()).resolves.toEqual(FAKE_ME);
    await expect(data.stateStore.getBaselineAlarmId()).resolves.toBe('1001');
  });

  it('다른 계정으로 바꾸는 것을 확인하면 state.db의 기록을 지우고 새 계정으로 시작하며, settings.json은 그대로 둔다', async () => {
    const { server, data, flowAccount } = await setup();
    server.addAccount('fake-key-1', FAKE_ME);
    server.addAccount('fake-key-other', OTHER);
    await flowAccount.checkKey('fake-key-1');
    await data.stateStore.setBaselineAlarmId('1001');
    /** 이 PC의 설정. */
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      workFolders: ['/fake/code'],
      repoMappings: { 'fake-project-1': ['/fake/code/repo'] },
      extraInstructions: '가짜 지침',
    };
    await data.settingsStore.save(settings);
    await flowAccount.checkKey('fake-key-other');

    await expect(flowAccount.confirmSwitch()).resolves.toEqual({ kind: 'connected' });

    expect(flowAccount.state()).toEqual({ account: OTHER, keyCheck: { status: 'idle' } });
    await expect(data.secretStore.readFlowApiKey()).resolves.toEqual({ kind: 'found', value: 'fake-key-other' });
    await expect(data.stateStore.getAccount()).resolves.toEqual(OTHER);
    await expect(data.stateStore.getBaselineAlarmId()).resolves.toBeNull();
    await expect(data.settingsStore.load()).resolves.toEqual(settings);
  });

  it('다른 계정으로 바꾸기를 취소하면 옛 키와 계정, 상태가 그대로이고, 그 뒤에 온 확인은 아무것도 바꾸지 않는다', async () => {
    const { server, data, flowAccount } = await setup();
    server.addAccount('fake-key-1', FAKE_ME);
    server.addAccount('fake-key-other', OTHER);
    await flowAccount.checkKey('fake-key-1');
    await data.stateStore.setBaselineAlarmId('1001');
    await flowAccount.checkKey('fake-key-other');

    flowAccount.cancelKeyCheck();

    expect(flowAccount.state()).toEqual({ account: FAKE_ME, keyCheck: { status: 'idle' } });
    await expect(flowAccount.confirmSwitch()).resolves.toEqual({ kind: 'cancelled' });
    await expect(data.secretStore.readFlowApiKey()).resolves.toEqual({ kind: 'found', value: 'fake-key-1' });
    await expect(data.stateStore.getAccount()).resolves.toEqual(FAKE_ME);
    await expect(data.stateStore.getBaselineAlarmId()).resolves.toBe('1001');
  });

  it('앞 확인이 키를 저장하는 동안 다른 계정의 키를 확인하면, 앞 저장이 끝난 뒤의 계정과 비교해 확인을 기다린다', async () => {
    const { server, encryption, data, flowAccount } = await setup();
    server.addAccount('fake-key-1', FAKE_ME);
    server.addAccount('fake-key-other', OTHER);
    /** 암호화를 붙잡아 두는 문을 여는 함수. */
    let openGate = () => {};
    encryption.encryptGate = new Promise((resolve) => {
      openGate = resolve;
    });
    /** 키를 저장하다 멈춘 앞 확인. */
    const first = flowAccount.checkKey('fake-key-1');
    await vi.waitFor(() => expect(encryption.encryptCalls).toBe(1));

    /** 그 사이에 시작한 다른 계정의 키 확인. */
    const second = flowAccount.checkKey('fake-key-other');
    await vi.waitFor(() => expect(server.requests).toHaveLength(2));
    openGate();

    await expect(first).resolves.toEqual({ kind: 'connected' });
    await expect(second).resolves.toEqual({ kind: 'needs-confirmation', account: OTHER });
    expect(flowAccount.state()).toEqual({ account: FAKE_ME, keyCheck: { status: 'awaiting-confirmation', account: OTHER } });
    await expect(data.secretStore.readFlowApiKey()).resolves.toEqual({ kind: 'found', value: 'fake-key-1' });
    await expect(data.stateStore.getAccount()).resolves.toEqual(FAKE_ME);
  });

  it('새 계정을 state.db에 남기지 못하면 저장 실패로 끝나고, 옛 키를 되돌려 옛 키와 계정을 그대로 둔다', async () => {
    const { server, data, flowAccount } = await setup();
    server.addAccount('fake-key-1', FAKE_ME);
    server.addAccount('fake-key-other', OTHER);
    await flowAccount.checkKey('fake-key-1');
    await flowAccount.checkKey('fake-key-other');
    // state.db에 쓸 수 없는 상황을 흉내 낸다.
    data.close();

    await expect(flowAccount.confirmSwitch()).resolves.toEqual({ kind: 'failed', reason: 'save-failed' });

    expect(flowAccount.state()).toEqual({ account: FAKE_ME, keyCheck: { status: 'idle' } });
    await expect(data.secretStore.readFlowApiKey()).resolves.toEqual({ kind: 'found', value: 'fake-key-1' });
  });

  it('처음 연결하는 계정을 state.db에 남기지 못하면 저장 실패로 끝나고, 새 키도 남기지 않는다', async () => {
    const { server, data, flowAccount } = await setup();
    server.addAccount('fake-key-1', FAKE_ME);
    data.close();

    await expect(flowAccount.checkKey('fake-key-1')).resolves.toEqual({ kind: 'failed', reason: 'save-failed' });

    expect(flowAccount.state()).toEqual({ account: null, keyCheck: { status: 'idle' } });
    await expect(data.secretStore.readFlowApiKey()).resolves.toEqual({ kind: 'missing' });
  });

  it('같은 계정의 새 키는 이름·소속을 state.db에 남기지 못해도 저장한 키로 연결된 채 끝난다', async () => {
    const { server, data, flowAccount } = await setup();
    server.addAccount('fake-key-1', FAKE_ME);
    server.addAccount('fake-key-2', { ...FAKE_ME, division: '바뀐 팀' });
    await flowAccount.checkKey('fake-key-1');
    data.close();

    await expect(flowAccount.checkKey('fake-key-2')).resolves.toEqual({ kind: 'connected' });

    expect(flowAccount.state()).toEqual({ account: FAKE_ME, keyCheck: { status: 'idle' } });
    await expect(data.secretStore.readFlowApiKey()).resolves.toEqual({ kind: 'found', value: 'fake-key-2' });
  });
});
