import { errorFields } from '../logging/logger';
import type { AgentId } from '../ports/executor';
import type { GlobalProblem, GlobalProblems } from '../problems/global-problems';
import { agentCandidates, type ListedModel } from './agent-cli';
import { AgentConnection, type AgentConnectionOptions } from './agent-connection';

/** 에이전트 전역 문제. */
type AgentProblem = Extract<GlobalProblem, { cause: 'agent' }>;

/** 연결 확인 묶음에 필요한 것. 에이전트를 뺀 나머지는 모든 연결 확인이 같이 쓴다. */
export type AgentConnectionsOptions = Omit<AgentConnectionOptions, 'agent'>;

/** 필수 설정 "에이전트 연결"의 상태. */
export type AgentSetupStatus = 'connected' | 'checking' | 'not-connected';

/**
 * 이 OS에서 후보가 되는 에이전트마다 둔 연결 확인의 묶음. macOS는 Claude Code와 Codex, Windows는 Claude Code만이다.
 * 에이전트 전역 문제는 대기열이 쓸 에이전트가 하나도 없을 때만 띄운다. 연결된 에이전트가 있으면 기본 에이전트가 그것으로 바뀌어
 * 대기열이 이어 가기 때문이다. 띄울 때는 저장한 기본 에이전트의 문제를 먼저 보이되, 설치된 에이전트의 문제를 CLI 없음보다 앞세운다.
 */
export class AgentConnections {
  /** 후보 순서대로 둔 연결 확인. */
  readonly all: readonly AgentConnection[];
  /** 연결 확인마다 마지막으로 알린 전역 문제. 해결했거나 감지 시작 전이라 띄우지 않으면 `null`. */
  private readonly reported = new Map<AgentId, AgentProblem | null>();
  /** 전역 문제를 정할 때마다 올리는 번호. 저장한 기본 에이전트를 읽는 사이에 다시 정하면 앞의 결과를 버린다. */
  private problemGeneration = 0;

  constructor(private readonly options: AgentConnectionsOptions) {
    this.all = agentCandidates(options.platform).map(
      (agent) => new AgentConnection({ ...options, agent, problems: this.problemsFor(agent) }),
    );
  }

  /** 에이전트의 연결 확인. 이 OS에서 후보가 아니면 `null`. */
  get(agent: AgentId): AgentConnection | null {
    return this.all.find((connection) => connection.agent === agent) ?? null;
  }

  /** 연결된 에이전트. 후보 순서다. */
  connectedAgents(): AgentId[] {
    return this.all.filter((connection) => connection.isConnected()).map((connection) => connection.agent);
  }

  /** 에이전트의 모델 목록. 후보가 아니면 비어 있다. */
  models(agent: AgentId): readonly ListedModel[] {
    return this.get(agent)?.models() ?? [];
  }

  /** 필수 설정 "에이전트 연결"의 상태. 아직 확인하지 않은 에이전트(시작 직후)도 확인 중으로 본다. */
  setupStatus(): AgentSetupStatus {
    if (this.all.some((connection) => connection.isConnected())) return 'connected';
    /** 확인을 마치지 않은 에이전트가 있는지. */
    const pending = this.all.some((connection) => ['idle', 'checking'].includes(connection.state().progress.status));
    return pending ? 'checking' : 'not-connected';
  }

  /** 모든 후보의 연결을 확인한다. 앱 시작과 설정 "에이전트" 칸을 열 때 쓴다. */
  async checkAll(): Promise<void> {
    await Promise.all(this.all.map((connection) => connection.check()));
  }

  /** 어느 에이전트든 연결 상태가 바뀔 때마다 `listener`를 부른다. 돌려준 함수를 부르면 그만 부른다. */
  onChange(listener: () => void): () => void {
    /** 연결 확인마다 붙인 구독을 끊는 함수. */
    const unsubscribes = this.all.map((connection) => connection.onChange(() => listener()));
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }

  /** 연결 확인 하나가 전역 문제를 알리는 곳. 알린 것을 모아 묶음 전체로 정한다. */
  private problemsFor(agent: AgentId): Pick<GlobalProblems, 'raise' | 'resolve'> {
    return {
      raise: (problem) => {
        if (problem.cause !== 'agent') return;
        this.reported.set(agent, problem);
        void this.settleProblem();
      },
      resolve: () => {
        this.reported.set(agent, null);
        void this.settleProblem();
      },
    };
  }

  /**
   * 묶음 전체의 에이전트 전역 문제를 정한다. 연결된 에이전트가 있으면 푼다. 다른 에이전트를 아직 확인하고 있으면 그 결과를 기다린다.
   * 모두 끝났는데 연결된 에이전트가 없으면 알린 문제 가운데 하나를 띄운다.
   */
  private async settleProblem(): Promise<void> {
    this.problemGeneration += 1;
    /** 이번에 정하는 번호. */
    const generation = this.problemGeneration;
    if (this.all.some((connection) => connection.isConnected())) {
      this.options.problems.resolve('agent');
      return;
    }
    if (this.all.some((connection) => connection.state().progress.status === 'checking')) return;

    /** 알린 문제. 후보 순서다. */
    const problems = this.all.map((connection) => this.reported.get(connection.agent)).filter((problem) => problem != null);
    if (problems.length === 0) {
      this.options.problems.resolve('agent');
      return;
    }
    /** 저장한 기본 에이전트. 읽지 못하면 후보 순서만 따른다. */
    const preferred = await this.options.settingsStore.load().then(
      (settings) => settings.defaultAgent,
      (error: unknown) => {
        this.options.logger.warn('agent.default-agent-unreadable', errorFields(error));
        return null;
      },
    );
    if (generation !== this.problemGeneration) return;
    this.options.problems.raise(primaryProblem(problems, preferred));
  }
}

/** 띄울 문제 하나. 설치된 에이전트의 문제(CLI 없음이 아님)를 앞세우고, 같으면 저장한 기본 에이전트, 그다음 후보 순서다. */
function primaryProblem(problems: readonly AgentProblem[], preferred: AgentId | null): AgentProblem {
  /** 앞세울 차례. 작을수록 앞이다. */
  const rank = (problem: AgentProblem) => (problem.reason === 'cli-missing' ? 2 : 0) + (problem.agent === preferred ? 0 : 1);
  return [...problems].sort((a, b) => rank(a) - rank(b))[0] as AgentProblem;
}
