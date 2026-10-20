import { isSameFlowUser } from '../flow/user-id';
import { errorFields, type Logger } from '../logging/logger';
import type { Clock } from '../ports/clock';
import type { FlowApi, FlowApiFailure, FlowEmployee } from '../ports/flow-api';
import type { SecretReadResult, SecretStore } from '../ports/secret-store';
import type { StateStore } from '../ports/state-store';
import { SerialQueue } from '../serial-queue';

/** 요청 한도(`429`)에 걸렸을 때 자동으로 다시 시도하는 횟수. */
const RATE_LIMIT_RETRIES = 3;
/** `Retry-After`가 없을 때 다시 시도하기 전에 기다리는 시간(밀리초). */
const DEFAULT_RETRY_DELAY_MS = 10_000;
/** 다시 시도하기 전에 기다리는 가장 짧은 시간(밀리초). */
const MIN_RETRY_DELAY_MS = 1_000;
/** 자동으로 기다려 줄 가장 긴 시간(밀리초). `Retry-After`가 이보다 길면 기다리지 않고 한도 실패로 끝낸다. */
const MAX_RETRY_DELAY_MS = 60_000;

/** 키 확인의 진행 상태. */
export type FlowKeyCheck =
  /** 진행 중인 확인이 없다. */
  | { status: 'idle' }
  /** Flow에 키를 확인하거나 확인한 키를 저장하고 있다. */
  | { status: 'checking' }
  /** 요청 한도에 걸려 잠시 뒤 자동으로 다시 확인한다. */
  | { status: 'waiting-retry' }
  /** 다른 계정의 키라서, 지금까지의 기록을 지우고 바꿀지 사용자의 확인을 기다린다. */
  | { status: 'awaiting-confirmation'; account: FlowEmployee };

/** Flow 계정 칸이 보일 상태. */
export interface FlowAccountState {
  /** 키 확인에 성공한 계정. 아직 없으면 `null`. */
  account: FlowEmployee | null;
  /** 키 확인의 진행 상태. */
  keyCheck: FlowKeyCheck;
}

/** 키 확인이 실패한 이유. 화면 문구는 렌더러가 고른다. */
export type FlowKeyCheckFailure =
  /** Flow가 키를 거부했다(`401`) */
  | 'unauthorized'
  /** Flow에 연결하지 못했다. */
  | 'network'
  /** 다시 시도해도 요청 한도(`429`)가 풀리지 않았다. */
  | 'rate-limited'
  /** Flow가 그 밖의 응답 코드나 모르는 모양의 응답을 줬다. */
  | 'unexpected'
  /** 확인은 됐지만 키나 계정을 저장하지 못했다. */
  | 'save-failed';

/** 키 확인 하나가 끝난 결과. */
export type FlowKeyCheckOutcome =
  /** 키를 저장하고 계정을 연결했다. */
  | { kind: 'connected' }
  /** 다른 계정의 키라서 사용자의 확인을 기다린다. 확인 전에는 아무것도 바꾸지 않았다. */
  | { kind: 'needs-confirmation'; account: FlowEmployee }
  /** 확인하지 못했다. 옛 키와 계정은 그대로다. */
  | { kind: 'failed'; reason: FlowKeyCheckFailure }
  /** 새 확인이나 취소로 이 확인을 그만뒀다. 아무것도 바꾸지 않았다. */
  | { kind: 'cancelled' };

/** Flow 계정에 필요한 포트. */
export interface FlowAccountOptions {
  /** 키 하나로 Flow API를 부르는 클라이언트를 만든다. */
  connectFlow: (apiKey: string) => FlowApi;
  /** 확인한 키를 두는 비밀 저장소. */
  secretStore: SecretStore;
  /** 계정을 두는 상태 저장소. */
  stateStore: StateStore;
  /** 다시 시도를 기다리는 시계. */
  clock: Clock;
  /** 진단 로그. 키와 사용자 ID는 남기지 않는다. */
  logger: Logger;
}

/** Flow가 확인해 준 키. 그 키를 확인한 확인 하나에 묶인다. */
interface VerifiedKey {
  /** 이 키를 확인한 확인 하나. */
  attempt: KeyCheckAttempt;
  /** 앞뒤 공백을 뺀 키. */
  apiKey: string;
  /** 키 소유자. */
  account: FlowEmployee;
}

/**
 * 설정 창 "Flow 계정" 칸의 일: 개인 API 키를 확인해 계정을 연결하고, 확인한 키만 저장한다.
 */
export class FlowAccount {
  /** 키 확인에 성공한 계정. */
  private account: FlowEmployee | null = null;
  /** 키 확인의 진행 상태. */
  private keyCheck: FlowKeyCheck = IDLE;
  /** 다른 계정의 키라서 사용자의 확인을 기다리는 키. */
  private pendingSwitch: VerifiedKey | null = null;
  /** 진행 중인 키 확인. */
  private attempt: KeyCheckAttempt | null = null;
  /** 상태가 바뀔 때 부를 함수. */
  private readonly listeners = new Set<(state: FlowAccountState) => void>();
  /**
   * 계정 비교와 저장의 차례. 앞 확인이 키를 저장하는 사이에 새 확인이 계정을 비교하면,
   * 옛 계정과 비교해 다른 계정의 키를 묻지 않고 저장할 수 있어 한 차례씩 한다.
   */
  private readonly saving = new SerialQueue();

  constructor(private readonly options: FlowAccountOptions) {}

  /** `state.db`에 둔 계정을 읽어 둔다. 앱이 시작할 때 한 번 부른다. */
  async load(): Promise<void> {
    this.setState({ account: await this.options.stateStore.getAccount() });
  }

  /** 지금 상태. */
  state(): FlowAccountState {
    return { account: this.account, keyCheck: this.keyCheck };
  }

  /** 상태가 바뀔 때마다 `listener`를 부른다. 돌려준 함수를 부르면 그만 부른다. */
  onChange(listener: (state: FlowAccountState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 붙여 넣은 키를 Flow에 확인하고, 성공하면 키와 계정을 저장한다.
   * 요청 한도에 걸리면 `Retry-After`만큼 기다렸다가 몇 번까지 자동으로 다시 확인한다.
   * 다른 계정의 키면 저장하지 않고 사용자의 확인(`confirmSwitch`)을 기다린다.
   */
  async checkKey(input: string): Promise<FlowKeyCheckOutcome> {
    /** 붙여 넣을 때 딸려 온 앞뒤 공백을 뺀 키. */
    const apiKey = input.trim();
    /** 이 키로 부르는 Flow API. */
    const flow = this.options.connectFlow(apiKey);
    // 새 확인이 앞 확인과 확인을 기다리던 계정 바꾸기를 대신한다.
    this.attempt?.cancel();
    this.pendingSwitch = null;
    /** 이번 확인. */
    const attempt = new KeyCheckAttempt(this.options.clock);
    this.attempt = attempt;
    this.setState({ keyCheck: { status: 'checking' } });

    for (let retries = 0; ; retries += 1) {
      /** 키 소유자 조회 결과. */
      const result = await flow.getMe();
      // 기다리는 사이에 새 확인이 시작됐거나 취소됐으면 결과를 버린다.
      if (attempt.cancelled) return CANCELLED;
      // 확인된 키는 차례를 기다려 계정을 비교한 뒤 저장하거나, 사용자의 확인을 기다린다.
      if (result.ok) return this.saving.run(() => this.accept({ attempt, apiKey, account: result.value }));

      // 요청 한도면 Retry-After만큼 기다렸다가 같은 키로 다시 확인한다. 너무 오래 기다려야 하면 기다리지 않는다.
      /** 다시 시도하기 전에 기다릴 시간. 다시 시도하지 않으면 `null`. */
      const delayMs =
        result.failure.kind === 'rate-limited' && retries < RATE_LIMIT_RETRIES ? retryDelayMs(result.failure.retryAfterMs) : null;
      if (delayMs !== null) {
        this.options.logger.info('flow-account.rate-limited', { delayMs, retry: retries + 1 });
        this.setState({ keyCheck: { status: 'waiting-retry' } });
        if (!(await attempt.wait(delayMs))) return CANCELLED;
        this.setState({ keyCheck: { status: 'checking' } });
        continue;
      }

      // 그 밖의 실패는 옛 키와 계정을 그대로 두고 끝낸다.
      this.options.logger.warn('flow-account.check-failed', { failure: result.failure.kind });
      return this.fail(attempt, checkFailureOf(result.failure));
    }
  }

  /** 다른 계정의 키로 바꾸는 것을 사용자가 확인했다. 지금까지의 기록을 지우고 새 계정으로 시작한다. */
  async confirmSwitch(): Promise<FlowKeyCheckOutcome> {
    /** 확인을 기다리던 키. */
    const pending = this.pendingSwitch;
    if (!pending || pending.attempt.cancelled) return CANCELLED;
    this.pendingSwitch = null;
    this.setState({ keyCheck: { status: 'checking' } });
    return this.saving.run(async () =>
      // 차례를 기다리는 사이에 새 확인이 시작됐으면 지우지 않는다.
      pending.attempt.cancelled ? CANCELLED : this.save(pending, 'reset-state'),
    );
  }

  /**
   * 진행 중인 키 확인과 확인을 기다리는 계정 바꾸기를 그만둔다. 아무것도 바꾸지 않는다.
   * 이미 저장을 시작한 확인은 끝까지 저장한다.
   */
  cancelKeyCheck(): void {
    this.attempt?.cancel();
    this.attempt = null;
    this.pendingSwitch = null;
    this.setState({ keyCheck: IDLE });
  }

  /** 확인된 키를 받아들인다. 처음이거나 같은 계정이면 저장하고, 다른 계정이면 사용자의 확인을 기다린다. */
  private async accept(verified: VerifiedKey): Promise<FlowKeyCheckOutcome> {
    // 차례를 기다리는 사이에 새 확인이 시작됐으면 저장하지 않는다.
    if (verified.attempt.cancelled) return CANCELLED;

    // 다른 계정의 키면 지금까지의 기록을 지워야 하므로, 사용자가 확인할 때까지 아무것도 바꾸지 않는다.
    if (this.account && !this.isConnectedAs(verified.account)) {
      this.pendingSwitch = verified;
      this.setState({ keyCheck: { status: 'awaiting-confirmation', account: verified.account } });
      this.options.logger.info('flow-account.switch-pending');
      return { kind: 'needs-confirmation', account: verified.account };
    }
    return this.save(verified, 'keep-state');
  }

  /**
   * 확인한 키와 계정을 저장한다. `reset-state`면 `state.db`의 기록을 모두 지우고 새 계정으로 시작한다.
   * `settings.json`은 어느 쪽이든 건드리지 않는다. 실패하면 옛 키와 계정을 그대로 둔다.
   */
  private async save({ attempt, apiKey, account }: VerifiedKey, mode: 'keep-state' | 'reset-state'): Promise<FlowKeyCheckOutcome> {
    /** 지금 연결된 계정과 같은 사람의 키인지 여부. 같은 사람의 새 키는 그대로 써도 된다. */
    const sameUser = this.isConnectedAs(account);
    /** 바꾸기 전 키. 다른 사람의 키를 저장한 뒤 계정 기록이 실패하면 이 키로 되돌린다. */
    const previousKey = sameUser ? null : await this.options.secretStore.readFlowApiKey();

    // 실패하기 쉬운 키 암호화를 먼저 한다. 여기서 실패하면 옛 키와 계정, 기록이 모두 그대로 남는다.
    try {
      await this.options.secretStore.writeFlowApiKey(apiKey);
    } catch (error) {
      this.options.logger.error('flow-account.key-save-failed', errorFields(error));
      return this.fail(attempt, 'save-failed');
    }

    try {
      if (mode === 'reset-state') await this.options.stateStore.resetForAccount(account);
      else await this.options.stateStore.setAccount(account);
    } catch (error) {
      this.options.logger.error('flow-account.account-save-failed', errorFields(error));
      // 같은 사람의 새 키는 그대로 쓰고 연결을 이어 간다. 바뀐 이름·소속은 다음 확인 때 다시 남긴다.
      if (sameUser) {
        if (!attempt.cancelled) this.setState({ keyCheck: IDLE });
        return CONNECTED;
      }
      // 기록된 계정과 다른 사람의 키가 남지 않게 키를 바꾸기 전으로 되돌린다.
      await this.restoreKey(previousKey);
      return this.fail(attempt, 'save-failed');
    }

    // 저장하는 사이에 취소됐으면 진행 상태는 그 뒤의 확인 몫이라 계정만 바꾼다.
    this.setState(attempt.cancelled ? { account } : { account, keyCheck: IDLE });
    this.options.logger.info('flow-account.connected', { resetState: mode === 'reset-state' });
    return CONNECTED;
  }

  /** 지금 연결된 계정이 `account`와 같은 사람인지 본다. 연결된 계정이 없으면 `false`. */
  private isConnectedAs(account: FlowEmployee): boolean {
    return this.account !== null && isSameFlowUser(this.account.userId, account.userId);
  }

  /** 확인이 실패로 끝났다. 그만둔 확인이 아니면 진행 상태를 비운다. */
  private fail(attempt: KeyCheckAttempt, reason: FlowKeyCheckFailure): FlowKeyCheckOutcome {
    if (!attempt.cancelled) this.setState({ keyCheck: IDLE });
    return { kind: 'failed', reason };
  }

  /**
   * 키를 바꾸기 전으로 되돌린다. 옛 키가 없었거나 읽을 수 없었으면 새 키를 지운다.
   * 되돌리지 못해도 이미 실패를 알리는 중이므로 로그만 남긴다.
   */
  private async restoreKey(previousKey: SecretReadResult | null): Promise<void> {
    try {
      if (previousKey?.kind === 'found') await this.options.secretStore.writeFlowApiKey(previousKey.value);
      else await this.options.secretStore.deleteFlowApiKey();
    } catch (error) {
      this.options.logger.error('flow-account.key-restore-failed', errorFields(error));
    }
  }

  /** 상태를 바꾸고, 실제로 바뀌었으면 듣는 쪽에 알린다. */
  private setState(next: { account?: FlowEmployee | null; keyCheck?: FlowKeyCheck }): void {
    /** 바꾼 뒤의 계정. */
    const account = next.account === undefined ? this.account : next.account;
    /** 바꾼 뒤의 진행 상태. */
    const keyCheck = next.keyCheck ?? this.keyCheck;
    if (account === this.account && isSameKeyCheck(keyCheck, this.keyCheck)) return;

    this.account = account;
    this.keyCheck = keyCheck;
    /** 알릴 상태. */
    const state = this.state();
    for (const listener of this.listeners) listener(state);
  }
}

/** 진행 중인 확인이 없는 상태. */
const IDLE: FlowKeyCheck = { status: 'idle' };

/** 두 진행 상태가 같은지 본다. */
function isSameKeyCheck(a: FlowKeyCheck, b: FlowKeyCheck): boolean {
  if (a.status === 'awaiting-confirmation' || b.status === 'awaiting-confirmation') return a === b;
  return a.status === b.status;
}

/** 그만둔 확인의 결과. */
const CANCELLED: FlowKeyCheckOutcome = { kind: 'cancelled' };
/** 키를 저장하고 계정을 연결한 결과. */
const CONNECTED: FlowKeyCheckOutcome = { kind: 'connected' };

/** 키 확인 하나. 그만두면 그 뒤의 결과는 버리고, 기다리던 다시 시도도 바로 끝낸다. */
class KeyCheckAttempt {
  /** 그만뒀는지 여부. */
  cancelled = false;
  /** 다시 시도를 기다리는 중이면 그 기다림을 바로 끝내는 함수. */
  private stopWaiting: (() => void) | null = null;

  constructor(private readonly clock: Clock) {}

  /** `ms` 동안 기다린다. 다 기다리면 `true`, 그 사이에 그만두면 바로 `false`로 끝난다. */
  wait(ms: number): Promise<boolean> {
    return new Promise((resolve) => {
      /** 예약한 다시 시도를 지우는 함수. */
      const cancelTimer = this.clock.after(ms, () => {
        this.stopWaiting = null;
        resolve(true);
      });
      this.stopWaiting = () => {
        cancelTimer();
        resolve(false);
      };
    });
  }

  /** 그만둔다. */
  cancel(): void {
    this.cancelled = true;
    this.stopWaiting?.();
    this.stopWaiting = null;
  }
}

/**
 * `Retry-After`로 받은 시간을 다시 시도하기 전에 기다릴 시간으로 바꾼다.
 * 없으면 기본값을 쓰고, 자동으로 기다려 줄 시간보다 길면 서버가 정한 시각보다 일찍 부르지 않도록 `null`을 돌려준다.
 */
function retryDelayMs(retryAfterMs: number | null): number | null {
  if (retryAfterMs === null) return DEFAULT_RETRY_DELAY_MS;
  if (retryAfterMs > MAX_RETRY_DELAY_MS) return null;
  return Math.max(MIN_RETRY_DELAY_MS, retryAfterMs);
}

/** Flow API 실패를 키 확인 실패 이유로 바꾼다. */
function checkFailureOf(failure: FlowApiFailure): FlowKeyCheckFailure {
  switch (failure.kind) {
    case 'unauthorized':
      return 'unauthorized';
    case 'network':
      return 'network';
    case 'rate-limited':
      return 'rate-limited';
    case 'http':
    case 'unexpected-response':
      return 'unexpected';
  }
}
