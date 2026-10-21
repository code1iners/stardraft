import { describe, expect, it } from 'vitest';
import * as ipc from '../../shared/ipc';
import { DEFAULT_SECRET_PATTERNS, SECRET_PATTERN_MAX_LENGTH } from '../agent/secret-patterns';
import { FakeClock } from '../fakes/fake-clock';
import { MemorySettingsStore } from '../fakes/memory-settings-store';
import { createLogger } from '../logging/logger';
import { DraftSettings, EXTRA_INSTRUCTIONS_MAX_LENGTH } from './draft-settings';

/** 가짜 설정 저장소 위에 설정 "초안" 칸을 만든다. 초안 대기열과 멘션 묶음에 맡긴 일은 기록만 한다. */
async function setup(initial: ConstructorParameters<typeof MemorySettingsStore>[0] = {}) {
  const settingsStore = new MemorySettingsStore(initial);
  /** 초안 대기열과 멘션 묶음에 맡긴 일. 맡긴 순서다. */
  const calls: unknown[] = [];
  const draftSettings = new DraftSettings({
    settingsStore,
    logger: createLogger([{ write: () => {} }], new FakeClock(0)),
    drafts: { restartForSecretPatterns: () => calls.push('restart') },
    bundles: {
      discardSecretEvidenceDrafts: async (patterns) => {
        calls.push({ recheck: [...patterns] });
        return [];
      },
    },
  });
  await draftSettings.load();
  /** 상태가 바뀌었다는 알림 수. */
  let changes = 0;
  draftSettings.onChange(() => (changes += 1));
  return { settingsStore, draftSettings, calls, changes: () => changes };
}

describe('설정 "초안" 칸: 추가 지침', () => {
  it('저장된 추가 지침을 읽고, 바꾼 지침을 저장해 알린다. 같은 지침과 너무 긴 지침은 저장하지 않는다', async () => {
    const { settingsStore, draftSettings, calls, changes } = await setup({ extraInstructions: '맺음말을 붙입니다.', workFolders: ['/fake/work'] });
    expect(draftSettings.state().extraInstructions).toBe('맺음말을 붙입니다.');

    await draftSettings.setExtraInstructions('맺음말을 붙입니다.');
    await draftSettings.setExtraInstructions('x'.repeat(EXTRA_INSTRUCTIONS_MAX_LENGTH + 1));
    expect(changes()).toBe(0);

    await draftSettings.setExtraInstructions('호칭은 "님"으로 씁니다.\n맺음말은 붙이지 않습니다.');

    expect(settingsStore.settings).toMatchObject({ extraInstructions: '호칭은 "님"으로 씁니다.\n맺음말은 붙이지 않습니다.', workFolders: ['/fake/work'] });
    expect(draftSettings.state().extraInstructions).toBe('호칭은 "님"으로 씁니다.\n맺음말은 붙이지 않습니다.');
    expect(changes()).toBe(1);
    // 추가 지침은 다음 실행부터 쓰므로 실행을 다시 돌리거나 초안을 다시 검사하지 않는다.
    expect(calls).toEqual([]);
  });
});

describe('설정 "초안" 칸: 비밀 파일 패턴', () => {
  it('기본 목록은 읽기 전용으로 보이고, 추가한 패턴은 그 아래 추가한 순서로 보인다', async () => {
    const { draftSettings } = await setup({ extraSecretPatterns: ['*.vault.yml'] });

    await draftSettings.addSecretPattern('credentials/**');

    expect(draftSettings.state()).toMatchObject({ defaultSecretPatterns: [...DEFAULT_SECRET_PATTERNS], extraSecretPatterns: ['*.vault.yml', 'credentials/**'] });
  });

  it('앞뒤 공백을 떼어 저장하고, 저장한 뒤 실행 중인 실행을 다시 돌리고 나서 기본 목록과 추가 패턴 전부로 초안을 다시 검사한다', async () => {
    const { settingsStore, draftSettings, calls, changes } = await setup();

    await expect(draftSettings.addSecretPattern('  *.vault.yml\t')).resolves.toBe('added');

    expect(settingsStore.settings.extraSecretPatterns).toEqual(['*.vault.yml']);
    expect(calls).toEqual(['restart', { recheck: [...DEFAULT_SECRET_PATTERNS, '*.vault.yml'] }]);
    expect(changes()).toBe(1);
  });

  it('빈 패턴, 실행기 규칙을 깨는 패턴, 되돌리기 패턴, 이미 있는 패턴은 받지 않는다. 기본 목록과 견줄 때 대소문자를 가리지 않는다', async () => {
    const { settingsStore, draftSettings, calls } = await setup({ extraSecretPatterns: ['*.vault.yml'] });

    expect(await draftSettings.addSecretPattern('   ')).toBe('empty');
    expect(await draftSettings.addSecretPattern('secret".txt')).toBe('invalid');
    expect(await draftSettings.addSecretPattern('Read(secret)')).toBe('invalid');
    expect(await draftSettings.addSecretPattern('config\\secret.txt')).toBe('invalid');
    expect(await draftSettings.addSecretPattern('!keep.env')).toBe('invalid');
    expect(await draftSettings.addSecretPattern('a\nb')).toBe('invalid');
    expect(await draftSettings.addSecretPattern('x'.repeat(201))).toBe('invalid');
    expect(await draftSettings.addSecretPattern('.ENV')).toBe('duplicate');
    expect(await draftSettings.addSecretPattern('*.Vault.yml')).toBe('duplicate');

    expect(settingsStore.settings.extraSecretPatterns).toEqual(['*.vault.yml']);
    expect(calls).toEqual([]);
  });

  it('설정을 저장하지 못하면 패턴을 더하지 않고 실행도 다시 돌리지 않는다', async () => {
    const { settingsStore, draftSettings, calls } = await setup();
    settingsStore.save = async () => {
      throw new Error('디스크가 가득 참');
    };

    await expect(draftSettings.addSecretPattern('*.vault.yml')).resolves.toBe('save-failed');

    expect(draftSettings.state().extraSecretPatterns).toEqual([]);
    expect(calls).toEqual([]);
  });
});

describe('설정 "초안" 칸: 화면과 같은 상한', () => {
  it('IPC 명령이 받는 추가 지침과 패턴의 길이 상한이 core의 상한과 같다', () => {
    expect(ipc.EXTRA_INSTRUCTIONS_MAX_LENGTH).toBe(EXTRA_INSTRUCTIONS_MAX_LENGTH);
    expect(ipc.SECRET_PATTERN_MAX_LENGTH).toBe(SECRET_PATTERN_MAX_LENGTH);
  });
});
