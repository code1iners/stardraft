/**
 * main과 렌더러 사이의 IPC 계약.
 * main → 렌더러로는 상태 스냅숏과 변경 이벤트가, 렌더러 → main으로는 명령이 간다.
 * 렌더러는 이 계약을 preload의 `window.stardraft`로만 쓴다.
 */

/** IPC 채널 이름. */
export const IPC_CHANNELS = {
  /** 렌더러가 전체 상태 스냅숏을 요청한다. */
  getSnapshot: 'stardraft:get-snapshot',
  /** 렌더러가 main에 명령을 보낸다. */
  command: 'stardraft:command',
  /** main이 렌더러에 변경 이벤트를 보낸다. */
  event: 'stardraft:event',
} as const;

/** 설정 창의 칸. 왼쪽 칸 목록에 이 순서로 보인다. */
export const SETTINGS_SECTIONS = ['flow-account', 'agent', 'repositories', 'drafts', 'general'] as const;

/** 설정 창의 칸 하나. */
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

/** 설정 "일반" 칸에서 여는 폴더. 경로는 main이 정하고 렌더러는 이름만 보낸다. */
export const APP_FOLDERS = ['data', 'logs'] as const;

/** 여는 폴더 하나. `data`는 데이터 폴더, `logs`는 진단 로그 폴더다. */
export type AppFolder = (typeof APP_FOLDERS)[number];

/** 렌더러가 그릴 앱 상태 전체. */
export interface AppSnapshot {
  /** 화면에 보일 앱 이름. 소스에서 실행하면 `Stardraft Dev`다. */
  appName: string;
  /** 앱 버전. */
  version: string;
  /** 실행 중인 OS. 문구와 배치를 OS에 맞출 때 쓴다. */
  platform: 'darwin' | 'win32' | 'other';
}

/** main → 렌더러 변경 이벤트. */
export type AppEvent =
  /** 이미 열린 설정 창에 이 칸을 보이라고 알린다. */
  { type: 'settings-section-requested'; section: SettingsSection };

/** 렌더러 → main 명령. */
export type AppCommand =
  /** 설정 창을 연다. 칸을 주면 그 칸을 보인다. */
  | { type: 'open-settings'; section?: SettingsSection }
  /** 데이터 폴더나 로그 폴더를 OS 파일 관리자로 연다. */
  | { type: 'open-folder'; folder: AppFolder };

/** preload가 렌더러에 `window.stardraft`로 노출하는 IPC. */
export interface StardraftBridge {
  /** 전체 상태 스냅숏을 받는다. */
  getSnapshot(): Promise<AppSnapshot>;
  /** main에 명령을 보낸다. */
  send(command: AppCommand): Promise<void>;
  /** 변경 이벤트를 구독한다. 돌려준 함수를 부르면 구독을 끝낸다. */
  onEvent(listener: (event: AppEvent) => void): () => void;
}

/** 설정 창 칸 이름인지 확인한다. */
export function isSettingsSection(value: unknown): value is SettingsSection {
  return typeof value === 'string' && (SETTINGS_SECTIONS as readonly string[]).includes(value);
}

/** 여는 폴더 이름인지 확인한다. */
function isAppFolder(value: unknown): value is AppFolder {
  return typeof value === 'string' && (APP_FOLDERS as readonly string[]).includes(value);
}

/**
 * 렌더러가 보낸 값을 명령으로 해석한다. 형식이 맞지 않으면 `null`이다.
 * 렌더러는 믿지 않으므로 main은 이 검사를 통과한 명령만 처리한다.
 */
export function parseAppCommand(value: unknown): AppCommand | null {
  if (typeof value !== 'object' || value === null) return null;
  /** 필드를 읽기 위해 객체로 본 값. */
  const candidate = value as Record<string, unknown>;

  switch (candidate.type) {
    case 'open-settings': {
      if (candidate.section === undefined) return { type: 'open-settings' };
      return isSettingsSection(candidate.section) ? { type: 'open-settings', section: candidate.section } : null;
    }
    case 'open-folder':
      return isAppFolder(candidate.folder) ? { type: 'open-folder', folder: candidate.folder } : null;
    default:
      return null;
  }
}
