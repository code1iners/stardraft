import { describe, expect, it } from 'vitest';
import { FakeClock } from '../fakes/fake-clock';
import { MemorySettingsStore } from '../fakes/memory-settings-store';
import { createLogger } from '../logging/logger';
import type { AgentId } from '../ports/executor';
import type { Settings } from '../ports/settings-store';
import type { ListedModel } from './agent-cli';
import { AgentPreferences } from './agent-preferences';
import { CLAUDE_MODEL_ALIASES } from './claude-cli';

/** Codex 연결 확인이 `codex debug models`에서 읽었다고 할 가짜 모델 목록. */
const CODEX_MODELS: ListedModel[] = [
  { id: 'gpt-fake-pro', label: 'GPT-Fake-Pro' },
  { id: 'gpt-fake-mini', label: 'GPT-Fake-Mini' },
];

/** 설정과 연결된 에이전트로 기본 에이전트·모델 선택을 만들고 저장된 설정을 읽어 둔다. 모델 목록은 연결 확인이 읽은 것이다. */
async function setup(connected: AgentId[], settings: Partial<Settings> = {}) {
  const settingsStore = new MemorySettingsStore(settings);
  /** 지금 연결된 에이전트. 테스트가 바꾼다. */
  let connectedAgents = connected;
  /** 연결 확인이 읽은 에이전트별 모델 목록. 테스트가 바꾼다. */
  const listed: Record<AgentId, readonly ListedModel[]> = { 'claude-code': CLAUDE_MODEL_ALIASES, codex: CODEX_MODELS };
  const preferences = new AgentPreferences({
    settingsStore,
    logger: createLogger([], new FakeClock()),
    connectedAgents: () => connectedAgents,
    listedModels: (agent) => listed[agent],
  });
  await preferences.load();
  /** 상태가 바뀐 횟수. */
  const changes = { count: 0 };
  preferences.onChange(() => (changes.count += 1));
  return {
    settingsStore,
    preferences,
    changes,
    setConnected: (agents: AgentId[]) => {
      connectedAgents = agents;
    },
    setListed: (agent: AgentId, models: readonly ListedModel[]) => {
      listed[agent] = models;
    },
  };
}

describe('기본 에이전트', () => {
  it('연결된 에이전트가 하나면 저장한 값과 상관없이 그 에이전트가 기본이다', async () => {
    const { preferences } = await setup(['claude-code'], { defaultAgent: 'codex' });

    expect(preferences.state()).toMatchObject({ connectedAgents: ['claude-code'], defaultAgent: 'claude-code' });
  });

  it('둘 이상 연결되면 처음에는 Claude Code를 미리 고르고, 사용자가 고른 에이전트를 저장한다', async () => {
    const { preferences, settingsStore } = await setup(['codex', 'claude-code']);
    expect(preferences.state().defaultAgent).toBe('claude-code');

    await preferences.setDefaultAgent('codex');

    expect(preferences.state().defaultAgent).toBe('codex');
    expect(settingsStore.settings.defaultAgent).toBe('codex');
  });

  it('고른 에이전트의 연결이 끊기면 남은 연결된 에이전트가 기본이다', async () => {
    const { preferences, setConnected } = await setup(['codex', 'claude-code'], { defaultAgent: 'codex' });

    setConnected(['claude-code']);

    expect(preferences.state().defaultAgent).toBe('claude-code');
  });

  it('연결된 에이전트가 없으면 기본 에이전트가 없다', async () => {
    const { preferences } = await setup([]);

    expect(preferences.state()).toMatchObject({ connectedAgents: [], defaultAgent: null });
  });

  it('연결되지 않은 에이전트는 기본으로 고를 수 없다', async () => {
    const { preferences, settingsStore, changes } = await setup(['claude-code']);

    await preferences.setDefaultAgent('codex');

    expect(settingsStore.settings.defaultAgent).toBe('claude-code');
    expect(changes.count).toBe(0);
  });
});

describe('모델 선택', () => {
  it('Claude Code는 Fable, Opus, Sonnet 별칭을 보이고 처음에는 기본 모델(에이전트가 정함)이다', async () => {
    const { preferences } = await setup(['claude-code']);

    expect(preferences.state().models['claude-code']).toEqual({
      options: [
        { id: 'fable', label: 'Fable', unlisted: false },
        { id: 'opus', label: 'Opus', unlisted: false },
        { id: 'sonnet', label: 'Sonnet', unlisted: false },
      ],
      selected: null,
    });
  });

  it('모델을 고르면 설정에 저장하고, 기본 모델을 고르면 저장한 모델을 지운다', async () => {
    const { preferences, settingsStore, changes } = await setup(['claude-code']);

    await preferences.setModel('claude-code', 'sonnet');
    expect(settingsStore.settings.agentModels).toEqual({ 'claude-code': 'sonnet' });
    expect(preferences.state().models['claude-code']?.selected).toBe('sonnet');

    await preferences.setModel('claude-code', null);
    expect(settingsStore.settings.agentModels).toEqual({});
    expect(preferences.state().models['claude-code']?.selected).toBeNull();
    expect(changes.count).toBe(2);
  });

  it('저장한 모델이 목록에서 사라졌으면 "(목록에 없음)"으로 표시할 항목을 끝에 남긴다', async () => {
    const { preferences } = await setup(['claude-code'], { agentModels: { 'claude-code': 'claude-retired-model' } });

    expect(preferences.state().models['claude-code']).toEqual({
      options: [
        { id: 'fable', label: 'Fable', unlisted: false },
        { id: 'opus', label: 'Opus', unlisted: false },
        { id: 'sonnet', label: 'Sonnet', unlisted: false },
        { id: 'claude-retired-model', label: 'claude-retired-model', unlisted: true },
      ],
      selected: 'claude-retired-model',
    });
  });

  it('목록에 없는 모델은 고를 수 없다(이미 저장한 모델은 그대로 둘 수 있다)', async () => {
    const { preferences, settingsStore } = await setup(['claude-code'], { agentModels: { 'claude-code': 'claude-retired-model' } });

    await preferences.setModel('claude-code', 'made-up-model');
    expect(settingsStore.settings.agentModels).toEqual({ 'claude-code': 'claude-retired-model' });

    await preferences.setModel('claude-code', 'opus');
    await preferences.setModel('claude-code', 'claude-retired-model');
    expect(settingsStore.settings.agentModels).toEqual({ 'claude-code': 'opus' });
  });

  it('Codex는 연결 확인이 codex debug models에서 읽은 목록을 보이고, 고른 모델이 다시 확인한 목록에서 사라지면 "(목록에 없음)"으로 남긴다', async () => {
    const { preferences, settingsStore, setListed } = await setup(['claude-code', 'codex']);

    await preferences.setModel('codex', 'gpt-fake-mini');
    expect(settingsStore.settings.agentModels).toEqual({ codex: 'gpt-fake-mini' });
    expect(preferences.state().models.codex).toEqual({
      options: [
        { id: 'gpt-fake-pro', label: 'GPT-Fake-Pro', unlisted: false },
        { id: 'gpt-fake-mini', label: 'GPT-Fake-Mini', unlisted: false },
      ],
      selected: 'gpt-fake-mini',
    });

    setListed('codex', [{ id: 'gpt-fake-pro', label: 'GPT-Fake-Pro' }]);

    expect(preferences.state().models.codex).toEqual({
      options: [
        { id: 'gpt-fake-pro', label: 'GPT-Fake-Pro', unlisted: false },
        { id: 'gpt-fake-mini', label: 'gpt-fake-mini', unlisted: true },
      ],
      selected: 'gpt-fake-mini',
    });
  });

  it('Codex 모델 목록을 읽지 못했으면(빈 목록) 기본 모델만 고를 수 있고, 목록에 없는 모델은 받지 않는다', async () => {
    const { preferences, settingsStore, setListed } = await setup(['codex']);
    setListed('codex', []);

    await preferences.setModel('codex', 'gpt-fake-pro');

    expect(settingsStore.settings.agentModels).toEqual({});
    expect(preferences.state().models.codex).toEqual({ options: [], selected: null });
  });

  it('모델 선택 상자는 연결된 에이전트에만 있다', async () => {
    const { preferences } = await setup([]);

    expect(preferences.state().models).toEqual({});
  });

  it('모델을 저장할 때 다른 칸에서 바꾼 설정을 덮지 않는다', async () => {
    const { preferences, settingsStore } = await setup(['claude-code']);
    settingsStore.settings.workFolders = ['/fake/work'];

    await preferences.setModel('claude-code', 'opus');

    expect(settingsStore.settings.workFolders).toEqual(['/fake/work']);
  });
});
