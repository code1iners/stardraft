import { errorFields, type Logger } from '../logging/logger';
import { latestAlarmId } from '../flow/alarm-id';
import type { FlowApiFailure, FlowConnection } from '../ports/flow-api';
import type { Notifier } from '../ports/notifier';
import type { SettingsStore } from '../ports/settings-store';
import type { StateStore } from '../ports/state-store';
import type { LaunchAtLogin } from './launch-at-login';

/** 감지를 시작하기 전에 필요한 필수 세 가지. 작은 창과 설정 창 띠에 이 순서로 보인다. */
export const SETUP_REQUIREMENTS = ['flow-key', 'agent', 'work-folders'] as const;

/** 필수 설정 하나. `flow-key`는 확인된 키, `agent`는 에이전트 연결, `work-folders`는 작업 폴더 1개 이상이다. */
export type SetupRequirement = (typeof SETUP_REQUIREMENTS)[number];

/** 필수 설정 하나의 상태. `checking`은 에이전트 연결을 확인하는 중이다. */
export type SetupRequirementStatus = 'done' | 'needed' | 'checking';

/** 필수 세 가지를 판단하는 데 쓰는 지금 앱 상태. 각 칸의 모듈이 저장한 값에서 읽는다. */
export interface SetupInputs {
  /** Flow가 확인해 준 키로 계정이 연결되어 있고 "키 확인 필요"가 없는지 여부. */
  keyVerified: boolean;
  /** 에이전트 연결 상태. */
  agent: 'connected' | 'checking' | 'not-connected';
  /** 작업 폴더 수. */
  workFolderCount: number;
}

/** [감지 시작]이 실패한 이유. */
export type DetectionStartFailure =
  /** 쓸 키가 없거나 읽을 수 없다. */
  | 'no-key'
  /** Flow가 키를 거부했다(`401`). */
  | 'unauthorized'
  /** Flow에 연결하지 못했다. */
  | 'network'
  /** 요청 한도(`429`)에 걸렸다. */
  | 'rate-limited'
  /** 그 밖의 응답 코드나 모르는 모양의 응답이다. */
  | 'unexpected'
  /** 기준점이나 설정을 저장하지 못했다. */
  | 'save-failed';

/** [감지 시작]의 진행 상태. */
export type DetectionStart =
  | { status: 'idle' }
  | { status: 'starting' }
  | { status: 'failed'; reason: DetectionStartFailure };

/** 온보딩 상태. 작은 창의 필수 설정 전 화면, 설정 창의 첫 설정 띠, 트레이 설정 필요 아이콘이 따른다. */
export interface OnboardingState {
  /** 감지를 시작했는지 여부. 시작한 뒤에는 첫 설정 띠와 필수 설정 전 화면이 다시 나오지 않는다. */
  detectionStarted: boolean;
  /** 필수 세 가지의 상태. */
  requirements: Record<SetupRequirement, SetupRequirementStatus>;
  /** 필수 세 가지가 모두 되어 [감지 시작]을 보일 수 있는지 여부. */
  ready: boolean;
  /** [감지 시작]의 진행 상태. */
  start: DetectionStart;
}

/** [감지 시작] 한 번의 결과. */
export type DetectionStartOutcome =
  /** 기준점을 잡고 감지를 시작했다. */
  | { kind: 'started' }
  /** 필수 설정 전이거나, 이미 시작했거나, 시작하는 중이라 아무것도 하지 않았다. */
  | { kind: 'skipped' }
  /** 시작하지 못했다. 감지 시작 전 그대로다. */
  | { kind: 'failed'; reason: DetectionStartFailure };

/** 온보딩에 필요한 포트. */
export interface OnboardingOptions {
  /** 감지 시작 여부를 두는 설정 저장소. */
  settingsStore: SettingsStore;
  /** 기준점을 두는 상태 저장소. */
  stateStore: StateStore;
  /** "멘션 감지를 시작했습니다" 알림을 띄울 곳. */
  notifier: Notifier;
  /** 진단 로그. */
  logger: Logger;
  /** [감지 시작]이 켜는 로그인 시 자동 시작. */
  launchAtLogin: LaunchAtLogin;
  /** 필수 세 가지를 판단할 지금 앱 상태. */
  setupInputs: () => SetupInputs;
  /** 지금 키로 Flow 연결을 만든다. 쓸 키가 없으면 `null`. */
  connectFlow: () => FlowConnection | null;
  /** 감지를 시작한 뒤 설정 창을 닫고 빈 작은 창을 띄운다. 시작 알림은 이 일이 끝난 뒤에 띄운다. */
  showDetectionStarted: () => Promise<void>;
}

/** 진행 중인 시작이 없는 상태. */
const IDLE: DetectionStart = { status: 'idle' };

/**
 * 첫 실행 온보딩: 필수 세 가지(확인된 키, 에이전트 연결, 작업 폴더)의 상태를 모으고, [감지 시작]으로 기준점을 잡는다.
 * 각 항목은 해당 칸의 모듈이 바로 저장하므로, 중간에 닫았다 다시 켜도 통과한 항목은 그대로다. 순서는 강제하지 않는다.
 */
export class Onboarding {
  /** 감지를 시작했는지 여부. */
  private detectionStarted = false;
  /** [감지 시작]의 진행 상태. */
  private start: DetectionStart = IDLE;
  /** 마지막으로 알린 상태. 입력이 바뀌어도 상태가 같으면 다시 알리지 않으려고 둔다. */
  private lastState: OnboardingState | null = null;
  /** 상태가 바뀔 때 부를 함수. */
  private readonly listeners = new Set<(state: OnboardingState) => void>();

  constructor(private readonly options: OnboardingOptions) {}

  /** 저장된 감지 시작 여부를 읽는다. 앱이 시작할 때 한 번 부른다. */
  async load(): Promise<void> {
    this.detectionStarted = (await this.options.settingsStore.load()).detectionStarted;
    this.lastState = this.state();
  }

  /** 지금 상태. 필수 세 가지는 부를 때마다 입력에서 읽는다. */
  state(): OnboardingState {
    /** 필수 세 가지의 상태. */
    const requirements = requirementsOf(this.options.setupInputs());
    return {
      detectionStarted: this.detectionStarted,
      requirements,
      ready: SETUP_REQUIREMENTS.every((requirement) => requirements[requirement] === 'done'),
      start: this.start,
    };
  }

  /** 상태가 바뀔 때마다 `listener`를 부른다. 돌려준 함수를 부르면 그만 부른다. */
  onChange(listener: (state: OnboardingState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 필수 세 가지의 입력(계정, 전역 문제, 에이전트 연결, 작업 폴더)이 바뀌었을 수 있다. 상태가 달라졌으면 알린다.
   * 필수 항목이 바뀌면 지난 [감지 시작] 실패 문구는 더 맞지 않으므로 지운다(예: 거부된 키를 다시 확인함).
   */
  refresh(): void {
    if (this.start.status === 'failed' && this.lastState && !sameRequirements(this.lastState, this.state())) this.start = IDLE;
    this.emitIfChanged();
  }

  /**
   * [감지 시작]. 알림 목록을 한 번 조회해 가장 최근 `alarmId`를 기준점으로 저장하고, 감지 시작과 로그인 시 자동 시작을 켠 뒤 시작 알림을 띄운다.
   * 과거 멘션은 가져오지 않는다. 기준점이나 감지 시작 여부를 저장하지 못하면 시작하지 않은 것으로 둔다.
   */
  async startDetection(): Promise<DetectionStartOutcome> {
    if (this.detectionStarted || this.start.status === 'starting' || !this.state().ready) return { kind: 'skipped' };
    this.setStart({ status: 'starting' });

    /** 지금 키로 만든 Flow 연결. */
    const flow = this.options.connectFlow();
    if (!flow) return this.fail('no-key');

    /** 가장 최근 쪽의 알림 목록. */
    const page = await flow.api.listMentionAlarms(null);
    if (!page.ok) {
      if (page.failure.kind === 'unauthorized') flow.reportKeyRejected();
      return this.fail(startFailureOf(page.failure));
    }

    /** 기준점. 알림이 하나도 없으면 0으로 잡아 그 뒤의 멘션을 모두 처리한다. */
    const baseline = latestAlarmId(page.value.alarms) ?? '0';
    try {
      await this.options.stateStore.setBaselineAlarmId(baseline);
      // 다른 칸의 변경을 덮지 않게 저장 직전에 설정을 다시 읽는다.
      /** 저장 직전의 설정. */
      const settings = await this.options.settingsStore.load();
      await this.options.settingsStore.save({ ...settings, detectionStarted: true });
    } catch (error) {
      this.options.logger.error('onboarding.start-save-failed', errorFields(error));
      return this.fail('save-failed');
    }

    this.detectionStarted = true;
    this.start = IDLE;
    this.options.logger.info('onboarding.detection-started', { alarmCount: page.value.alarms.length });
    this.emitIfChanged();
    // 자동 시작을 켜지 못해도 감지는 시작한 것으로 둔다. 설정 "일반"에서 다시 켤 수 있다.
    await this.options.launchAtLogin.set(true);
    await this.options.showDetectionStarted();
    // macOS는 첫 알림 때 권한을 물으므로, 사용자가 빈 작은 창을 보고 있는 지금 띄운다.
    this.options.notifier.notify({
      title: '멘션 감지를 시작했습니다',
      body: '나를 지목한 새 멘션이 오면 답변 초안을 만들어 알려 드립니다.',
    });
    return { kind: 'started' };
  }

  /** 시작이 실패했다고 두고 결과를 돌려준다. */
  private fail(reason: DetectionStartFailure): DetectionStartOutcome {
    this.options.logger.warn('onboarding.start-failed', { reason });
    this.setStart({ status: 'failed', reason });
    return { kind: 'failed', reason };
  }

  /** [감지 시작]의 진행 상태를 바꾸고 알린다. */
  private setStart(start: DetectionStart): void {
    this.start = start;
    this.emitIfChanged();
  }

  /** 마지막으로 알린 상태와 다르면 알린다. */
  private emitIfChanged(): void {
    /** 지금 상태. */
    const next = this.state();
    if (this.lastState && sameState(this.lastState, next)) return;
    this.lastState = next;
    for (const listener of this.listeners) listener(next);
  }
}

/** 입력에서 필수 세 가지의 상태를 정한다. */
function requirementsOf({ keyVerified, agent, workFolderCount }: SetupInputs): Record<SetupRequirement, SetupRequirementStatus> {
  return {
    'flow-key': keyVerified ? 'done' : 'needed',
    agent: agent === 'connected' ? 'done' : agent === 'checking' ? 'checking' : 'needed',
    'work-folders': workFolderCount > 0 ? 'done' : 'needed',
  };
}

/** Flow API 실패를 [감지 시작] 실패 이유로 바꾼다. */
function startFailureOf(failure: FlowApiFailure): DetectionStartFailure {
  switch (failure.kind) {
    case 'unauthorized':
    case 'network':
    case 'rate-limited':
      return failure.kind;
    default:
      return 'unexpected';
  }
}

/** 두 상태의 필수 세 가지가 같은지 본다. */
function sameRequirements(a: OnboardingState, b: OnboardingState): boolean {
  return SETUP_REQUIREMENTS.every((requirement) => a.requirements[requirement] === b.requirements[requirement]);
}

/** 두 상태가 화면에 같게 보이는지 본다. */
function sameState(a: OnboardingState, b: OnboardingState): boolean {
  return (
    a.detectionStarted === b.detectionStarted &&
    sameRequirements(a, b) &&
    a.start.status === b.start.status &&
    (a.start.status !== 'failed' || b.start.status !== 'failed' || a.start.reason === b.start.reason)
  );
}
