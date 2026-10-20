import type { AgentId } from './executor';

/** 에디터에서 열기에 쓸 에디터. 설치된 에디터를 고르거나 명령을 직접 적는다. */
export type EditorChoice =
  /** 앱이 줄 단위로 여는 방법을 아는 에디터. */
  | { kind: 'app'; appId: string }
  /** `{file}`, `{line}` 자리를 넣은 명령 한 줄. */
  | { kind: 'command'; command: string };

/** 사용자 설정(`settings.json`). PC마다 따로 두고 동기화하지 않는다. */
export interface Settings {
  /** 파일 형식 버전. 앱이 아는 것보다 크면 실행하지 않는다. */
  schemaVersion: number;
  /** 작업 폴더의 절대 경로 목록. */
  workFolders: string[];
  /** 저장소 매핑. Flow 프로젝트 ID → 저장소 절대 경로 목록. */
  repoMappings: Record<string, string[]>;
  /** 기본 에이전트. */
  defaultAgent: AgentId;
  /** 에이전트별 CLI 절대 경로. */
  agentCliPaths: Partial<Record<AgentId, string>>;
  /** 에이전트별로 고른 모델. */
  agentModels: Partial<Record<AgentId, string>>;
  /** 기본 목록에 더한 비밀 파일 패턴. */
  extraSecretPatterns: string[];
  /** 모든 초안에 적용할 추가 지침. */
  extraInstructions: string;
  /** 에디터에서 열기에 쓸 에디터. 아직 고르지 않았으면 `null`. */
  editor: EditorChoice | null;
  /** 로그인 시 자동 시작 여부. */
  launchAtLogin: boolean;
  /** 감지를 시작했는지 여부. */
  detectionStarted: boolean;
}

/** 이 앱이 아는 `settings.json` 형식 버전. */
export const SETTINGS_SCHEMA_VERSION = 1;

/** 처음 실행할 때의 설정. */
export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  workFolders: [],
  repoMappings: {},
  defaultAgent: 'claude-code',
  agentCliPaths: {},
  agentModels: {},
  extraSecretPatterns: [],
  extraInstructions: '',
  editor: null,
  launchAtLogin: false,
  detectionStarted: false,
};

/** 설정 저장소 포트. 바꾸는 즉시 저장한다. */
export interface SettingsStore {
  /** 저장된 설정을 읽는다. 처음이면 기본 설정을 돌려준다. */
  load(): Promise<Settings>;
  /** 설정 전체를 저장한다. */
  save(settings: Settings): Promise<void>;
}
