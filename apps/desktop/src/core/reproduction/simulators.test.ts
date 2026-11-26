import { describe, expect, it } from 'vitest';
import { exited, FakeProcessRunner } from '../fakes/fake-process-runner';
import { Simulators } from './simulators';

/** `xcrun simctl list devices booted -j`의 출력. 실제 모양에서 앱이 읽는 필드만 남겼다. */
function bootedJson(udids: readonly string[]): string {
  return JSON.stringify({
    devices: { 'com.apple.CoreSimulator.SimRuntime.iOS-26-0': udids.map((udid) => ({ udid, state: 'Booted', name: `가짜 iPhone ${udid}` })) },
  });
}

/** 가짜 adb 경로. */
const ADB = '/Users/fake/Library/Android/sdk/platform-tools/adb';

/** 가짜 실행기와 정리기를 만든다. `ios`는 실행 전후에 켜진 시뮬레이터, `ports`는 실행 전후에 열린 에뮬레이터 콘솔 포트다. */
function setup({ xcode = true, ios = [[], []], ports = [[], []] }: { xcode?: boolean; ios?: [string[], string[]]; ports?: [number[], number[]] } = {}) {
  const runner = new FakeProcessRunner();
  runner.respond('/usr/bin/xcode-select', ['-p'], exited(xcode ? 0 : 2, xcode ? '/Applications/Xcode.app/Contents/Developer\n' : ''));
  /** 지금이 실행 뒤인지 여부. */
  let after = false;
  runner.respond('/usr/bin/xcrun', ['simctl', 'list', 'devices', 'booted', '-j'], () => exited(0, bootedJson(ios[after ? 1 : 0])));
  runner.respondWhen((request) => request.command === '/usr/bin/xcrun' && request.args[1] === 'shutdown', exited(0));
  runner.respondWhen((request) => request.command === ADB, exited(0, 'OK: killing emulator, bye bye\n'));
  const simulators = new Simulators({
    runner,
    env: () => ({ PATH: '/usr/bin:/bin', HOME: '/Users/fake' }),
    isPortOpen: async (port) => ports[after ? 1 : 0].includes(port),
    fileExists: async (path) => path === ADB,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  });
  return { runner, simulators, markAfter: () => (after = true) };
}

/** 실행기가 받은 명령줄. */
function commands(runner: FakeProcessRunner): string[] {
  return runner.requests.map((request) => [request.command, ...request.args].join(' '));
}

describe('시뮬레이터와 에뮬레이터 정리', () => {
  it('실행 전에 켜져 있던 iOS 시뮬레이터는 그대로 두고, 실행 뒤 새로 켜진 것만 끈다', async () => {
    const { runner, simulators, markAfter } = setup({ ios: [['USER-SIM'], ['USER-SIM', 'NEW-SIM']] });

    const before = await simulators.snapshot();
    markAfter();
    await simulators.shutDownNew(before);

    expect(commands(runner)).toContain('/usr/bin/xcrun simctl shutdown NEW-SIM');
    expect(commands(runner)).not.toContain('/usr/bin/xcrun simctl shutdown USER-SIM');
  });

  it('새로 켜진 Android 에뮬레이터만 adb로 끄고, 실행 전부터 켜진 에뮬레이터와 adb 서버는 그대로 둔다', async () => {
    const { runner, simulators, markAfter } = setup({ ports: [[5554], [5554, 5556]] });

    const before = await simulators.snapshot();
    markAfter();
    await simulators.shutDownNew(before);

    /** adb에 보낸 명령. */
    const adb = commands(runner).filter((line) => line.startsWith(ADB));
    expect(adb).toEqual([`${ADB} -s emulator-5556 emu kill`]);
  });

  it('실행 전에는 adb를 부르지 않는다. adb를 부르면 꺼져 있던 adb 서버가 켜진다', async () => {
    const { runner, simulators } = setup({ ports: [[5554], [5554]] });

    await simulators.snapshot();

    expect(commands(runner).some((line) => line.startsWith(ADB))).toBe(false);
  });

  it('새로 켜진 것이 없으면 아무것도 끄지 않는다', async () => {
    const { runner, simulators, markAfter } = setup({ ios: [['USER-SIM'], ['USER-SIM']], ports: [[5554], [5554]] });

    const before = await simulators.snapshot();
    markAfter();
    await simulators.shutDownNew(before);

    expect(commands(runner).filter((line) => line.includes('shutdown') || line.includes('emu kill'))).toEqual([]);
  });

  it('Xcode가 없으면 시뮬레이터 목록을 부르지 않는다(xcrun이 설치 창을 띄울 수 있다)', async () => {
    const { runner, simulators, markAfter } = setup({ xcode: false });

    const before = await simulators.snapshot();
    markAfter();
    await simulators.shutDownNew(before);

    expect(commands(runner).some((line) => line.startsWith('/usr/bin/xcrun'))).toBe(false);
  });
});
