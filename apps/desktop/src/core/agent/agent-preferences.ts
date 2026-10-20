import { errorFields, type Logger } from '../logging/logger';
import type { AgentId } from '../ports/executor';
import { DEFAULT_SETTINGS, type SettingsStore } from '../ports/settings-store';
import { CLAUDE_MODEL_ALIASES, type ListedModel } from './claude-cli';

/** 모델 선택 상자의 항목 하나. */
export interface ModelOption {
  /** CLI에 넘길 모델 값. */
  id: string;
  /** 화면에 보일 이름. */
  label: string;
  /** 저장한 모델이 목록에서 사라져 "(목록에 없음)"을 붙여 남긴 항목인지 여부. */
  unlisted: boolean;
}

/** 에이전트 하나의 모델 선택 상자. 첫 항목 "기본 모델(에이전트가 정함)"은 담지 않고 화면이 붙인다. */
export interface ModelChoice {
  /** 고를 수 있는 모델. */
  options: ModelOption[];
  /** 고른 모델. 기본 모델이면 `null`이고, 이때는 `--model`을 넘기지 않는다. */
  selected: string | null;
}

/** 설정 "에이전트" 칸의 기본 에이전트와 모델 선택 상태. */
export interface AgentPreferencesState {
  /** 연결된 에이전트. 둘 이상이면 기본 에이전트를 고르는 칸이 보인다. */
  connectedAgents: AgentId[];
  /** 실행에 쓸 기본 에이전트. 연결된 에이전트가 없으면 `null`. */
  defaultAgent: AgentId | null;
  /** 연결된 에이전트별 모델 선택 상자. */
  models: Partial<Record<AgentId, ModelChoice>>;
}

/** 기본 에이전트와 모델 선택에 필요한 것. */
export interface AgentPreferencesOptions {
  /** 기본 에이전트와 에이전트별 모델을 두는 설정 저장소. */
  settingsStore: SettingsStore;
  /** 진단 로그. */
  logger: Logger;
  /** 지금 연결된 에이전트. 연결 확인이 정한다. */
  connectedAgents: () => readonly AgentId[];
}

/** 설정에서 읽어 둔 값. */
interface SavedPreferences {
  /** 저장한 기본 에이전트. */
  defaultAgent: AgentId;
  /** 저장한 에이전트별 모델. */
  agentModels: Partial<Record<AgentId, string>>;
}

/**
 * 기본 에이전트와 에이전트별 모델 선택.
 * 연결된 에이전트가 하나면 그 에이전트가 자동으로 기본이고, 둘 이상이면 고르게 하되 처음에는 Claude Code를 고른다.
 * 모델은 바꾸는 즉시 `settings.json`에 저장하고 다음 실행부터 쓴다.
 */
export class AgentPreferences {
  /** 설정에서 읽어 둔 값. */
  private saved: SavedPreferences = { defaultAgent: DEFAULT_SETTINGS.defaultAgent, agentModels: {} };
  /** 상태가 바뀔 때 부를 함수. */
  private readonly listeners = new Set<() => void>();

  constructor(private readonly options: AgentPreferencesOptions) {}

  /** 저장된 기본 에이전트와 모델을 읽는다. */
  async load(): Promise<void> {
    /** 저장된 설정. */
    const settings = await this.options.settingsStore.load();
    this.saved = { defaultAgent: settings.defaultAgent, agentModels: { ...settings.agentModels } };
  }

  /** 지금 상태. 연결된 에이전트는 부를 때마다 연결 확인에서 읽는다. */
  state(): AgentPreferencesState {
    /** 연결된 에이전트. */
    const connectedAgents = [...this.options.connectedAgents()];
    return {
      connectedAgents,
      defaultAgent: defaultAgentFor(connectedAgents, this.saved.defaultAgent),
      models: Object.fromEntries(
        connectedAgents.map((agent) => [agent, modelChoice(listedModels(agent), this.saved.agentModels[agent] ?? null)]),
      ),
    };
  }

  /** 상태가 바뀔 때마다 `listener`를 부른다. 돌려준 함수를 부르면 그만 부른다. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 기본 에이전트를 고른다. 연결되지 않은 에이전트는 받지 않는다. */
  async setDefaultAgent(agent: AgentId): Promise<void> {
    if (!this.options.connectedAgents().includes(agent)) {
      this.options.logger.warn('agent-preferences.default-agent-rejected', { agent });
      return;
    }
    await this.save({ ...this.saved, defaultAgent: agent });
  }

  /** 에이전트의 모델을 고른다. `null`은 기본 모델이다. 목록에 없는 모델은 이미 저장한 모델일 때만 받는다. */
  async setModel(agent: AgentId, model: string | null): Promise<void> {
    /** 지금 저장한 모델. */
    const current = this.saved.agentModels[agent] ?? null;
    if (model !== null && model !== current && !listedModels(agent).some((listed) => listed.id === model)) {
      this.options.logger.warn('agent-preferences.model-rejected', { agent });
      return;
    }
    /** 바꾼 모델 설정. 기본 모델이면 이 에이전트의 값을 지운다. */
    const agentModels = { ...this.saved.agentModels };
    if (model === null) delete agentModels[agent];
    else agentModels[agent] = model;
    await this.save({ ...this.saved, agentModels });
  }

  /** 바꾼 값을 저장하고 알린다. 다른 칸의 변경을 덮지 않게 저장 직전에 설정을 다시 읽는다. */
  private async save(next: SavedPreferences): Promise<void> {
    try {
      /** 저장 직전의 설정. */
      const settings = await this.options.settingsStore.load();
      await this.options.settingsStore.save({ ...settings, defaultAgent: next.defaultAgent, agentModels: next.agentModels });
    } catch (error) {
      this.options.logger.error('agent-preferences.save-failed', errorFields(error));
      return;
    }
    this.saved = next;
    for (const listener of this.listeners) listener();
  }
}

/** 연결된 에이전트 가운데 실행에 쓸 기본 에이전트. 저장한 값이 연결되어 있으면 그것, 아니면 Claude Code, 그도 아니면 첫 에이전트다. */
function defaultAgentFor(connected: readonly AgentId[], saved: AgentId): AgentId | null {
  if (connected.includes(saved)) return saved;
  if (connected.includes('claude-code')) return 'claude-code';
  return connected[0] ?? null;
}

/** 에이전트의 모델 목록. Codex 목록은 Codex 연결 확인이 더한다. */
function listedModels(agent: AgentId): readonly ListedModel[] {
  return agent === 'claude-code' ? CLAUDE_MODEL_ALIASES : [];
}

/** 모델 목록과 저장한 모델로 선택 상자를 만든다. 저장한 모델이 목록에 없으면 끝에 남긴다. */
function modelChoice(listed: readonly ListedModel[], saved: string | null): ModelChoice {
  /** 목록의 항목. */
  const options: ModelOption[] = listed.map((model) => ({ ...model, unlisted: false }));
  if (saved !== null && !listed.some((model) => model.id === saved)) options.push({ id: saved, label: saved, unlisted: true });
  return { options, selected: saved };
}
