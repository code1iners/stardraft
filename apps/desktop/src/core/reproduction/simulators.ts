import { access } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { delimiter, join } from 'node:path';
import type { ProcessRunner } from '../agent/process-runner';
import { asRecord } from '../agent/executor-output';
import type { Logger } from '../logging/logger';

/** 목록·종료 명령 하나를 기다리는 시간(밀리초). iOS 시뮬레이터 종료는 실측 12초 걸렸다. */
const COMMAND_TIMEOUT_MS = 60_000;

/** Android 에뮬레이터 콘솔 포트. 에뮬레이터는 5554부터 짝수 포트를 하나씩 쓰고, 시리얼은 `emulator-<포트>`다. */
const EMULATOR_CONSOLE_PORTS: readonly number[] = Array.from({ length: 16 }, (_, index) => 5554 + index * 2);

/** 켜져 있는 시뮬레이터와 에뮬레이터. */
export interface DeviceSnapshot {
  /** 켜진 iOS 시뮬레이터 UDID. */
  ios: string[];
  /** 켜진 Android 에뮬레이터 시리얼(`emulator-<포트>`). 실기기는 들지 않는다. */
  android: string[];
}

/** 시뮬레이터 정리에 필요한 것. */
export interface SimulatorsOptions {
  /** `xcrun`·`adb`를 띄우는 프로세스 실행기. */
  runner: ProcessRunner;
  /** 에이전트 CLI의 자식 환경. adb를 찾는 `PATH`·`ANDROID_HOME`·`HOME`을 읽는다. 아직 모르면 `null`. */
  env: () => Readonly<Record<string, string>> | null;
  /** localhost의 포트가 열려 있는지 본다. 에뮬레이터 콘솔 포트로 켜진 에뮬레이터를 알아낸다. */
  isPortOpen: (port: number) => Promise<boolean>;
  /** 파일이 있는지 본다. 없으면 파일 시스템을 본다. */
  fileExists?: (path: string) => Promise<boolean>;
  /** 진단 로그. 기기 이름은 남기지 않는다. */
  logger: Logger;
}

/**
 * 재현하는 진단 전후의 시뮬레이터·에뮬레이터 정리. 실행 전에 켜져 있던 것을 기록하고 실행 뒤 새로 켜진 것만 끈다.
 * iOS는 `simctl`의 켜진 목록, Android는 에뮬레이터 콘솔 포트로 가린다. 실행 전에는 adb를 부르지 않는다(꺼져 있던 adb 서버를 켜게 된다).
 * adb 서버는 사용자도 쓰는 공용 데몬이라 끄지 않고, 실기기에는 종료 명령을 보내지 않는다. 앱은 시뮬레이터를 켜거나 준비하지 않는다.
 */
export class Simulators {
  constructor(private readonly options: SimulatorsOptions) {}

  /** 지금 켜져 있는 시뮬레이터와 에뮬레이터. 알 수 없는 쪽은 비어 있다. */
  async snapshot(): Promise<DeviceSnapshot> {
    /** iOS와 Android. 서로 기다리지 않는다. */
    const [ios, android] = await Promise.all([this.bootedSimulators(), this.runningEmulators()]);
    return { ios, android };
  }

  /** `before` 뒤에 새로 켜진 시뮬레이터와 에뮬레이터를 끄고 끝나기를 기다린다. 끄지 못해도 던지지 않는다. */
  async shutDownNew(before: DeviceSnapshot): Promise<void> {
    /** 지금 켜진 것. */
    const now = await this.snapshot();
    /** 새로 켜진 iOS 시뮬레이터. */
    const ios = now.ios.filter((udid) => !before.ios.includes(udid));
    /** 새로 켜진 Android 에뮬레이터. */
    const android = now.android.filter((serial) => !before.android.includes(serial));
    if (ios.length === 0 && android.length === 0) return;
    /** adb 경로. 에뮬레이터를 끌 때만 찾는다. */
    const adb = android.length > 0 ? await this.adbPath() : null;
    if (android.length > 0 && adb === null) this.options.logger.warn('reproduction.adb-missing', { emulators: android.length });
    await Promise.all([
      ...ios.map((udid) => this.run('/usr/bin/xcrun', ['simctl', 'shutdown', udid])),
      ...(adb === null ? [] : android.map((serial) => this.run(adb, ['-s', serial, 'emu', 'kill']))),
    ]);
    this.options.logger.info('reproduction.devices-shut-down', { ios: ios.length, android: adb === null ? 0 : android.length });
  }

  /** 켜진 iOS 시뮬레이터 UDID. Xcode가 없으면 `xcrun`이 설치 창을 띄울 수 있어 부르지 않는다. */
  private async bootedSimulators(): Promise<string[]> {
    /** Xcode 개발자 폴더 확인. */
    const xcode = await this.run('/usr/bin/xcode-select', ['-p']);
    if (xcode === null) return [];
    /** 켜진 목록(JSON). */
    const listed = await this.run('/usr/bin/xcrun', ['simctl', 'list', 'devices', 'booted', '-j']);
    if (listed === null) return [];
    try {
      /** 런타임별 기기 목록. */
      const devices = asRecord(asRecord(JSON.parse(listed))?.devices) ?? {};
      return Object.values(devices).flatMap((list) =>
        Array.isArray(list) ? list.map(asRecord).flatMap((device) => (device?.state === 'Booted' && typeof device.udid === 'string' ? [device.udid] : [])) : [],
      );
    } catch {
      return [];
    }
  }

  /** 켜진 Android 에뮬레이터 시리얼. 콘솔 포트가 열린 것이다. */
  private async runningEmulators(): Promise<string[]> {
    /** 포트마다 열렸는지. */
    const open = await Promise.all(EMULATOR_CONSOLE_PORTS.map((port) => this.options.isPortOpen(port).catch(() => false)));
    return EMULATOR_CONSOLE_PORTS.filter((_, index) => open[index]).map((port) => `emulator-${port}`);
  }

  /** adb 경로. `ANDROID_HOME`·`ANDROID_SDK_ROOT`, `PATH`, 기본 SDK 위치 순서로 찾는다. 없으면 `null`. */
  private async adbPath(): Promise<string | null> {
    /** 자식 환경. */
    const env = this.options.env() ?? {};
    /** 찾아볼 경로. */
    const candidates = [
      ...[env.ANDROID_HOME, env.ANDROID_SDK_ROOT].flatMap((sdk) => (sdk ? [join(sdk, 'platform-tools', 'adb')] : [])),
      ...(env.PATH ?? '').split(delimiter).flatMap((dir) => (dir ? [join(dir, 'adb')] : [])),
      ...(env.HOME ? [join(env.HOME, 'Library', 'Android', 'sdk', 'platform-tools', 'adb')] : []),
    ];
    /** 파일이 있는지 보는 함수. */
    const exists = this.options.fileExists ?? ((path: string) => access(path).then(() => true, () => false));
    for (const candidate of candidates) if (await exists(candidate)) return candidate;
    return null;
  }

  /** 명령을 돌려 종료 코드 0이면 표준 출력, 아니면 `null`. */
  private async run(command: string, args: string[]): Promise<string | null> {
    /** 결과. */
    const result = await this.options.runner.run({ command, args, env: { ...(this.options.env() ?? { PATH: '/usr/bin:/bin' }) }, cwd: '/', timeoutMs: COMMAND_TIMEOUT_MS });
    return result.kind === 'exited' && result.exitCode === 0 ? result.stdout : null;
  }
}

/** localhost 포트에 접속해 보는 시간(밀리초). 열린 포트는 바로 받는다. */
const PORT_PROBE_TIMEOUT_MS = 300;

/** localhost의 `port`에 TCP로 접속해 열려 있는지 본다. 에뮬레이터 콘솔 포트를 보는 데 쓴다. */
export function localPortOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    /** 접속 시도. */
    const socket = createConnection({ host: '127.0.0.1', port });
    /** 결과를 한 번만 돌려준다. */
    const done = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(PORT_PROBE_TIMEOUT_MS, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}
