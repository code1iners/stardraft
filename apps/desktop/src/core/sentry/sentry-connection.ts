import { errorFields, type Logger } from '../logging/logger';
import type { SentryApiFailure, SentryOrganization, ConnectSentry } from '../ports/sentry-api';
import type { SentryTokenStore } from '../ports/sentry-token-store';
import type { SettingsStore } from '../ports/settings-store';
import type { GlobalProblems, SentryTokenProblemReason } from '../problems/global-problems';
import { SerialQueue } from '../serial-queue';

/** 토큰 연결에 쓰는 `org:read` scope. 조직 목록을 읽는 데 필요하고, 연결 확인이 실패하면 이 이름을 짚어 알린다. */
export const SENTRY_ORGANIZATION_SCOPE = 'org:read';

/** 토큰 확인의 진행 상태. */
export type SentryTokenCheck =
  /** 진행 중인 확인이 없다. */
  | { status: 'idle' }
  /** Sentry에 토큰을 확인하거나 확인한 토큰을 저장하고 있다. */
  | { status: 'checking' };

/** 설정 창 "Sentry" 칸이 보일 상태. */
export interface SentryConnectionState {
  /** 토큰을 연결했는지 여부. 거부됐거나 읽을 수 없는 토큰도 연결한 것으로 본다(토큰 카드에 "토큰 확인 필요"가 보인다). */
  connected: boolean;
  /** 토큰으로 보이는 조직. 연결하지 않았으면 비어 있다. */
  organizations: readonly SentryOrganization[];
  /** 토큰 확인의 진행 상태. */
  tokenCheck: SentryTokenCheck;
  /** "토큰 확인 필요"의 이유. 문제가 없으면 `null`. 다른 전역 문제에 가려 맨 앞에 보이지 않아도 이 값은 남는다. */
  problem: SentryTokenProblemReason | null;
}

/** 토큰 확인이 실패한 이유. 화면 문구는 렌더러가 고른다. */
export type SentryTokenCheckFailure =
  /** Sentry가 토큰을 거부했다(`401`). */
  | 'unauthorized'
  /** 토큰에 `org:read` scope가 없다(`403`). */
  | 'scope-missing'
  /** 토큰은 받아 줬지만 보이는 조직이 하나도 없다. */
  | 'no-organizations'
  /** Sentry에 연결하지 못했다. */
  | 'network'
  /** 요청 한도(`429`)에 걸렸다. */
  | 'rate-limited'
  /** Sentry가 그 밖의 응답 코드나 모르는 모양의 응답을 줬다. */
  | 'unexpected'
  /** 확인은 됐지만 토큰이나 조직을 저장하지 못했다. */
  | 'save-failed';

/** 토큰 확인 하나가 끝난 결과. */
export type SentryTokenCheckOutcome =
  /** 토큰을 저장하고 연결했다. */
  | { kind: 'connected' }
  /** 확인하지 못했다. 옛 토큰과 조직은 그대로다. */
  | { kind: 'failed'; reason: SentryTokenCheckFailure }
  /** 새 확인이나 취소로 이 확인을 그만뒀다. 아무것도 바꾸지 않았다. */
  | { kind: 'cancelled' };

/** Sentry 토큰 연결에 필요한 포트. */
export interface SentryConnectionOptions {
  /** 토큰 하나로 Sentry API를 부르는 클라이언트를 만든다. */
  connectSentry: ConnectSentry;
  /** 확인한 토큰을 두는 비밀 저장소. */
  tokenStore: SentryTokenStore;
  /** 조직과 지역 주소를 두는 설정 저장소. */
  settingsStore: SettingsStore;
  /** 진단 로그. 토큰은 남기지 않는다. */
  logger: Logger;
  /** "토큰 확인 필요"를 올리고 내리는 전역 문제 상태. */
  problems: GlobalProblems;
}

/**
 * 설정 창 "Sentry" 칸의 일: 개인 토큰을 조직 목록으로 확인해 연결하고, 확인한 토큰만 저장한다.
 * 토큰 문제는 Sentry 전역 문제 하나만 올리므로 Flow 감지와 Flow 초안은 멈추지 않는다.
 */
export class SentryConnection {
  /** 토큰으로 보이는 조직. */
  private organizations: readonly SentryOrganization[] = [];
  /** 토큰을 연결했는지 여부. */
  private connected = false;
  /** 토큰 확인의 진행 상태. */
  private tokenCheck: SentryTokenCheck = IDLE;
  /** 지금 쓰는 토큰. 저장된 토큰을 읽었거나 확인한 토큰을 저장했을 때 정해진다. */
  private currentToken: string | null = null;
  /** 올려 둔 "토큰 확인 필요"의 이유. */
  private problem: SentryTokenProblemReason | null = null;
  /** 진행 중인 확인의 번호. 새 확인이나 취소가 번호를 올려, 앞 확인의 늦은 결과를 버린다. */
  private attempt = 0;
  /** 상태가 바뀔 때 부를 함수. */
  private readonly listeners = new Set<(state: SentryConnectionState) => void>();
  /** 저장과 읽기와 끊기의 차례. 읽는 사이에 저장한 새 토큰을 늦게 끝난 읽기가 옛 결과로 덮지 않게 한다. */
  private readonly saving = new SerialQueue();

  constructor(private readonly options: SentryConnectionOptions) {}

  /** 설정 파일에 둔 조직을 읽어 둔다. 앱이 시작할 때 한 번 부른다. */
  async load(): Promise<void> {
    /** 설정의 조직. */
    const { sentryOrganizations } = await this.options.settingsStore.load();
    this.setState({ organizations: sentryOrganizations, connected: sentryOrganizations.length > 0 });
  }

  /**
   * 저장된 토큰을 읽어 지금 쓰는 토큰으로 둔다. 앱이 시작할 때 `load` 뒤에 한 번 부른다.
   * 토큰을 풀 수 없거나(키체인 거부, 항목 삭제, 다른 PC로 복사) 조직은 있는데 토큰이 없으면 "토큰 확인 필요"를 올린다.
   * macOS는 업데이트 뒤 이 읽기에서 키체인 재허용을 묻고 사용자가 답할 때까지 끝나지 않으므로, 앱 시작을 이 읽기로 막지 않는다.
   */
  async checkStoredToken(): Promise<void> {
    await this.saving.run(async () => {
      /** 저장된 토큰을 읽은 결과. */
      const stored = await this.options.tokenStore.read();
      if (stored.kind === 'found') {
        this.currentToken = stored.value;
        return;
      }
      // 연결한 적이 없으면 문제가 아니다. 토큰은 설정 창에서 받는다.
      if (stored.kind === 'missing' && !this.connected) return;

      this.options.logger.warn('sentry-connection.stored-token-unreadable', { result: stored.kind });
      this.raise('unreadable');
    });
  }

  /** 지금 쓰는 토큰. 연결하지 않았거나 저장된 토큰을 읽을 수 없으면 `null`. */
  token(): string | null {
    return this.currentToken;
  }

  /** 지금 상태. */
  state(): SentryConnectionState {
    return { connected: this.connected, organizations: this.organizations, tokenCheck: this.tokenCheck, problem: this.problem };
  }

  /** 상태가 바뀔 때마다 `listener`를 부른다. 돌려준 함수를 부르면 그만 부른다. */
  onChange(listener: (state: SentryConnectionState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Sentry가 `token`으로 부른 호출을 거절했다(감지·조회의 `401`·`403`). 지금 쓰는 토큰이면 "토큰 확인 필요"를 올린다.
   * 토큰을 바꾸기 전에 보낸 요청의 실패가 늦게 와도 새 토큰을 문제로 보지 않게, 지금 토큰이 아니면 무시한다.
   * 거절이 아닌 실패(네트워크, 한도)는 토큰 문제가 아니므로 무시한다.
   */
  reportApiFailure(token: string, failure: SentryApiFailure): void {
    if (token !== this.currentToken) return;
    if (failure.kind !== 'unauthorized' && failure.kind !== 'forbidden') return;
    /** 문제의 이유. */
    const reason = failure.kind === 'unauthorized' ? 'rejected' : 'scope-missing';
    this.options.logger.warn('sentry-connection.token-rejected', { reason });
    this.raise(reason);
  }

  /**
   * 붙여 넣은 토큰을 조직 목록으로 확인하고, 성공하면 토큰과 조직·지역 주소를 저장한다. 조직이 하나 이상 보여야 한다.
   * 실패하면 옛 토큰과 조직, "토큰 확인 필요"를 그대로 둔다. 새 토큰이 확인되면 "토큰 확인 필요"는 해제된다.
   */
  async checkToken(input: string): Promise<SentryTokenCheckOutcome> {
    /** 붙여 넣을 때 딸려 온 앞뒤 공백을 뺀 토큰. */
    const token = input.trim();
    /** 이번 확인의 번호. */
    const attempt = this.startAttempt();
    this.setState({ tokenCheck: CHECKING });

    /** 조직 목록을 읽은 결과. */
    const result = await this.options.connectSentry(token).listOrganizations();
    // 기다리는 사이에 새 확인이 시작됐거나 취소됐으면 결과를 버린다.
    if (attempt !== this.attempt) return CANCELLED;
    if (!result.ok) {
      this.options.logger.warn('sentry-connection.check-failed', { failure: result.failure.kind });
      return this.fail(checkFailureOf(result.failure));
    }
    if (result.value.length === 0) {
      this.options.logger.warn('sentry-connection.check-failed', { failure: 'no-organizations' });
      return this.fail('no-organizations');
    }
    return this.saving.run(() => this.save(attempt, token, result.value));
  }

  /** 진행 중인 토큰 확인을 그만둔다. 아무것도 바꾸지 않는다. 이미 저장을 시작한 확인은 끝까지 저장한다. */
  cancelTokenCheck(): void {
    this.attempt += 1;
    this.setState({ tokenCheck: IDLE });
  }

  /**
   * 연결을 끊는다. 토큰과 토큰으로 읽은 조직만 지우고 다른 설정과 기록은 건드리지 않는다. "토큰 확인 필요"도 함께 해제한다.
   * 지우지 못하면 연결을 그대로 두고 `false`를 돌려준다.
   */
  async disconnect(): Promise<boolean> {
    this.cancelTokenCheck();
    return this.saving.run(async () => {
      try {
        await this.options.tokenStore.delete();
        await this.saveOrganizations([]);
      } catch (error) {
        this.options.logger.error('sentry-connection.disconnect-failed', errorFields(error));
        return false;
      }
      this.currentToken = null;
      this.options.problems.resolve('sentry-token');
      this.setState({ organizations: [], connected: false, problem: null });
      this.options.logger.info('sentry-connection.disconnected');
      return true;
    });
  }

  /** 확인한 토큰과 조직을 저장한다. 실패하면 옛 토큰과 조직을 그대로 둔다. */
  private async save(attempt: number, token: string, organizations: readonly SentryOrganization[]): Promise<SentryTokenCheckOutcome> {
    // 차례를 기다리는 사이에 새 확인이 시작됐으면 저장하지 않는다.
    if (attempt !== this.attempt) return CANCELLED;

    /** 바꾸기 전 토큰. 조직을 저장하지 못하면 이 토큰으로 되돌린다. */
    const previous = await this.options.tokenStore.read();
    // 실패하기 쉬운 토큰 암호화를 먼저 한다. 여기서 실패하면 옛 토큰과 조직이 모두 그대로 남는다.
    try {
      await this.options.tokenStore.write(token);
    } catch (error) {
      this.options.logger.error('sentry-connection.token-save-failed', errorFields(error));
      return this.fail('save-failed');
    }
    try {
      await this.saveOrganizations(organizations);
    } catch (error) {
      this.options.logger.error('sentry-connection.organizations-save-failed', errorFields(error));
      await this.restoreToken(previous);
      return this.fail('save-failed');
    }

    this.currentToken = token;
    // Sentry가 받아 준 토큰이므로 "토큰 확인 필요"는 해결됐다.
    this.options.problems.resolve('sentry-token');
    this.setState({ organizations, connected: true, tokenCheck: IDLE, problem: null });
    this.options.logger.info('sentry-connection.connected', { organizationCount: organizations.length });
    return CONNECTED;
  }

  /** 설정 파일의 조직을 바꾼다. 다른 칸의 변경을 덮지 않게 저장 직전에 설정을 다시 읽는다. */
  private async saveOrganizations(organizations: readonly SentryOrganization[]): Promise<void> {
    /** 저장 직전의 설정. */
    const settings = await this.options.settingsStore.load();
    await this.options.settingsStore.save({ ...settings, sentryOrganizations: organizations.map((organization) => ({ ...organization })) });
  }

  /** 토큰을 바꾸기 전으로 되돌린다. 옛 토큰이 없었거나 읽을 수 없었으면 새 토큰을 지운다. 되돌리지 못하면 로그만 남긴다. */
  private async restoreToken(previous: Awaited<ReturnType<SentryTokenStore['read']>>): Promise<void> {
    try {
      if (previous.kind === 'found') await this.options.tokenStore.write(previous.value);
      else await this.options.tokenStore.delete();
    } catch (error) {
      this.options.logger.error('sentry-connection.token-restore-failed', errorFields(error));
    }
  }

  /** "토큰 확인 필요"를 올리고 이유를 상태에 남긴다. */
  private raise(reason: SentryTokenProblemReason): void {
    this.options.problems.raise({ cause: 'sentry-token', reason });
    this.setState({ problem: reason });
  }

  /** 새 확인을 시작한다. 앞 확인은 그만둔 것으로 본다. */
  private startAttempt(): number {
    this.attempt += 1;
    return this.attempt;
  }

  /** 확인이 실패로 끝났다. 진행 상태를 비운다. */
  private fail(reason: SentryTokenCheckFailure): SentryTokenCheckOutcome {
    this.setState({ tokenCheck: IDLE });
    return { kind: 'failed', reason };
  }

  /** 상태를 바꾸고, 실제로 바뀌었으면 듣는 쪽에 알린다. */
  private setState(next: {
    organizations?: readonly SentryOrganization[];
    connected?: boolean;
    tokenCheck?: SentryTokenCheck;
    problem?: SentryTokenProblemReason | null;
  }): void {
    /** 바꾸기 전 상태. */
    const before = this.state();
    this.organizations = next.organizations ?? this.organizations;
    this.connected = next.connected ?? this.connected;
    this.tokenCheck = next.tokenCheck ?? this.tokenCheck;
    this.problem = next.problem === undefined ? this.problem : next.problem;
    if (
      before.connected === this.connected &&
      before.problem === this.problem &&
      before.tokenCheck.status === this.tokenCheck.status &&
      before.organizations === this.organizations
    ) {
      return;
    }
    /** 알릴 상태. */
    const state = this.state();
    for (const listener of this.listeners) listener(state);
  }
}

/** 진행 중인 확인이 없는 상태. */
const IDLE: SentryTokenCheck = { status: 'idle' };
/** 확인하는 중인 상태. */
const CHECKING: SentryTokenCheck = { status: 'checking' };
/** 그만둔 확인의 결과. */
const CANCELLED: SentryTokenCheckOutcome = { kind: 'cancelled' };
/** 토큰을 저장하고 연결한 결과. */
const CONNECTED: SentryTokenCheckOutcome = { kind: 'connected' };

/** Sentry API 실패를 토큰 확인 실패 이유로 바꾼다. */
function checkFailureOf(failure: SentryApiFailure): SentryTokenCheckFailure {
  switch (failure.kind) {
    case 'unauthorized':
      return 'unauthorized';
    case 'forbidden':
      return 'scope-missing';
    case 'network':
      return 'network';
    case 'rate-limited':
      return 'rate-limited';
    case 'http':
    case 'unexpected-response':
      return 'unexpected';
  }
}
