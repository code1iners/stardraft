import { DEFAULT_SECRET_PATTERNS, hasSecretPattern, readSecretPattern, withDefaultSecretPatterns } from '../agent/secret-patterns';
import type { MentionBundles } from '../bundles/mention-bundles';
import { errorFields, type Logger } from '../logging/logger';
import type { SettingsStore } from '../ports/settings-store';
import { SerialQueue } from '../serial-queue';
import type { DraftQueue } from './draft-queue';

/** 추가 지침의 가장 긴 길이. */
export const EXTRA_INSTRUCTIONS_MAX_LENGTH = 4_000;

/** 설정 "초안" 칸의 상태. */
export interface DraftSettingsState {
  /** 모든 초안에 적용할 추가 지침. 기본 지침 뒤에 붙는다. */
  extraInstructions: string;
  /** 앱에 넣어 둔 비밀 파일 패턴. 읽기 전용이다. */
  defaultSecretPatterns: string[];
  /** 사용자가 추가한 비밀 파일 패턴. 추가한 순서다. */
  extraSecretPatterns: string[];
}

/**
 * 비밀 파일 패턴을 추가한 결과.
 * - `added`: 추가해 저장했다.
 * - `empty`: 빈 패턴이다.
 * - `invalid`: 실행기 규칙에 넣을 수 없는 패턴이다(따옴표·괄호·역슬래시·제어 문자, `!`로 시작, 너무 김).
 * - `duplicate`: 기본 목록이나 추가한 패턴에 이미 있다.
 * - `save-failed`: 설정을 저장하지 못했다.
 */
export type SecretPatternAddResult = 'added' | 'empty' | 'invalid' | 'duplicate' | 'save-failed';

/** 설정 "초안" 칸에 필요한 것. */
export interface DraftSettingsOptions {
  /** 추가 지침과 추가 비밀 파일 패턴을 두는 설정 저장소. */
  settingsStore: SettingsStore;
  /** 진단 로그. 지침과 패턴의 글은 남기지 않는다. */
  logger: Logger;
  /** 패턴을 추가하면 실행 중인 실행을 처음부터 다시 돌릴 초안 대기열. */
  drafts: Pick<DraftQueue, 'restartForSecretPatterns'>;
  /** 패턴을 추가하면 게시하지 않은 초안의 근거를 다시 검사할 멘션 묶음. */
  bundles: Pick<MentionBundles, 'discardSecretEvidenceDrafts'>;
}

/**
 * 설정 "초안" 칸의 추가 지침과 비밀 파일 패턴.
 * 추가 지침은 저장만 하고 다음 실행부터 쓴다. 이미 만든 초안은 다시 만들지 않는다.
 * 비밀 파일 패턴은 추가만 할 수 있고 앱 전체에 적용한다. 추가하면 실행 중인 실행을 취소해 대기열 맨 앞에 다시 넣고,
 * 게시하지 않은 초안의 근거 경로를 새 패턴으로 다시 검사한다.
 */
export class DraftSettings {
  /** 설정에서 읽어 둔 값. */
  private saved: Pick<DraftSettingsState, 'extraInstructions' | 'extraSecretPatterns'> = { extraInstructions: '', extraSecretPatterns: [] };
  /** 설정을 읽고 저장하는 일을 하나씩 하는 줄. 거의 동시에 바꿔도 앞의 변경을 덮지 않게 한다. */
  private readonly lane = new SerialQueue();
  /** 상태가 바뀔 때 부를 함수. */
  private readonly listeners = new Set<() => void>();

  constructor(private readonly options: DraftSettingsOptions) {}

  /** 저장된 추가 지침과 추가 비밀 파일 패턴을 읽는다. */
  async load(): Promise<void> {
    /** 저장된 설정. */
    const settings = await this.options.settingsStore.load();
    this.saved = { extraInstructions: settings.extraInstructions, extraSecretPatterns: [...settings.extraSecretPatterns] };
  }

  /** 지금 상태. */
  state(): DraftSettingsState {
    return { ...this.saved, defaultSecretPatterns: [...DEFAULT_SECRET_PATTERNS], extraSecretPatterns: [...this.saved.extraSecretPatterns] };
  }

  /** 상태가 바뀔 때마다 `listener`를 부른다. 돌려준 함수를 부르면 그만 부른다. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 추가 지침을 저장한다. 여러 줄 입력이라 칸을 벗어날 때 부른다. 실행 중인 실행은 그대로 끝나고 다음 실행부터 쓴다.
   * 너무 긴 지침과 그대로인 지침은 저장하지 않는다. 저장하지 못하면 로그만 남긴다.
   */
  setExtraInstructions(text: string): Promise<void> {
    return this.lane.run(async () => {
      if (text.length > EXTRA_INSTRUCTIONS_MAX_LENGTH || text === this.saved.extraInstructions) return;
      try {
        // 다른 칸의 변경을 덮지 않게 저장 직전에 설정을 다시 읽는다.
        /** 저장 직전의 설정. */
        const settings = await this.options.settingsStore.load();
        await this.options.settingsStore.save({ ...settings, extraInstructions: text });
      } catch (error) {
        this.options.logger.error('draft-settings.instructions-save-failed', errorFields(error));
        return;
      }
      this.saved = { ...this.saved, extraInstructions: text };
      this.options.logger.info('draft-settings.instructions-changed', { length: text.length });
      this.emit();
    });
  }

  /**
   * 비밀 파일 패턴을 추가한다. 저장한 뒤 실행 중인 실행을 새 패턴으로 다시 돌리고, 게시하지 않은 초안의 근거를 다시 검사한다.
   * 실행을 다시 돌리는 것이 먼저다. 그래야 검사하는 사이에 옛 패턴으로 끝난 실행이 초안을 저장하지 않는다.
   * 끊기에는 늦어 이미 저장하는 중인 초안은 멘션 묶음이 저장을 마친 뒤에 함께 검사한다.
   */
  async addSecretPattern(input: string): Promise<SecretPatternAddResult> {
    /** 읽은 패턴. */
    const read = readSecretPattern(input);
    if (read.kind !== 'pattern') return read.kind;
    /** 추가할 패턴. */
    const { pattern } = read;
    /** 패턴을 더해 저장한 추가 패턴. 더하지 않았으면 그 결과다. */
    const extraSecretPatterns = await this.lane.run(async (): Promise<string[] | SecretPatternAddResult> => {
      try {
        /** 저장 직전의 설정. */
        const settings = await this.options.settingsStore.load();
        if (hasSecretPattern(withDefaultSecretPatterns(settings.extraSecretPatterns), pattern)) return 'duplicate';
        /** 패턴을 더한 추가 패턴. */
        const patterns = [...settings.extraSecretPatterns, pattern];
        await this.options.settingsStore.save({ ...settings, extraSecretPatterns: patterns });
        this.saved = { ...this.saved, extraSecretPatterns: patterns };
        return patterns;
      } catch (error) {
        this.options.logger.error('draft-settings.pattern-save-failed', errorFields(error));
        return 'save-failed';
      }
    });
    if (!Array.isArray(extraSecretPatterns)) return extraSecretPatterns;
    this.options.logger.info('draft-settings.pattern-added', { count: extraSecretPatterns.length });
    this.emit();

    this.options.drafts.restartForSecretPatterns();
    await this.options.bundles.discardSecretEvidenceDrafts(withDefaultSecretPatterns(extraSecretPatterns));
    return 'added';
  }

  /** 듣는 쪽에 상태가 바뀌었다고 알린다. */
  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
