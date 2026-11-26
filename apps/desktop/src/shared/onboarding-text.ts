import type { AppSnapshot, DetectionStartFailure, SettingsSection, SetupRequirement } from './ipc';

/** 필수 설정 줄의 이름. */
export const SETUP_REQUIREMENT_LABELS: Record<SetupRequirement, string> = {
  agent: '에이전트',
};

/** 필수 설정 줄을 누르면 여는 설정 창의 칸. */
export const SETUP_REQUIREMENT_SECTIONS: Record<SetupRequirement, SettingsSection> = {
  agent: 'agent',
};

/** 작은 창 체크리스트의 묶음 이름. 필수 설정과, 연결하지 않아도 되는 감지할 대상이다. */
export const SETUP_GROUP_LABELS = { required: '필수', targets: '감지할 대상 · 선택' } as const;

/** 감지할 대상 줄의 이름. 연결하면 `✓`, 아니면 "연결 안 함"이 오른쪽에 보인다. */
export const DETECTION_TARGET_LABEL = 'Flow 계정';

/** 설정 창 맨 위 띠의 안내. 필수 설정이 남았을 때 보이고, 칸으로 가는 단추는 [에이전트 설정]이다. */
export const SETUP_BAND_TEXT = '필수 설정: 에이전트 연결';

/** 필수 설정을 마쳤는데 연결한 서비스가 없을 때 [감지 시작] 위에 보이는 안내. 막지는 않는다. */
export const NO_DETECTION_TARGET_NOTICE = '연결한 서비스가 없어 아직 감지할 대상이 없습니다. 지금 시작하고 나중에 서비스를 연결해도 됩니다.';

/** [감지 시작]이 실패했을 때 버튼 아래에 보일 문장. */
export const DETECTION_START_FAILURE_MESSAGES: Record<DetectionStartFailure, string> = {
  'no-key': '저장된 키를 읽을 수 없습니다. Flow 계정에서 키를 다시 확인해 주세요.',
  unauthorized: 'Flow가 키를 거부했습니다. Flow 계정에서 키를 다시 입력해 주세요.',
  network: 'Flow에 연결할 수 없습니다. 네트워크를 확인하고 다시 눌러 주세요.',
  'rate-limited': 'Flow 요청 한도에 걸렸습니다. 잠시 뒤 다시 눌러 주세요.',
  unexpected: 'Flow 알림 목록을 읽지 못했습니다. 잠시 뒤 다시 눌러 주세요.',
  'save-failed': '감지 시작을 저장하지 못했습니다. 다시 눌러 주세요.',
};

/** [감지 시작] 곁의 안내 두 줄. 첫 줄은 로그인 시 자동 시작, 둘째 줄은 알림이다. Windows는 알림 권한을 묻지 않아 아이콘 상태를 안내한다. */
export function detectionStartHints(platform: AppSnapshot['platform'], appName: string): [string, string] {
  return [
    `로그인할 때 ${appName}가 자동으로 켜집니다. 설정의 일반에서 끌 수 있습니다.`,
    platform === 'win32'
      ? '초안이 준비되면 알림으로 알려 드립니다. 작업 표시줄 아이콘이 채워지면 검토할 초안이 있습니다.'
      : '곧 macOS가 알림 허용을 묻습니다. 허용하면 초안이 준비될 때 알려 드립니다. 허용하지 않아도 메뉴 막대 아이콘이 채워지면 검토할 초안이 있습니다.',
  ];
}

/** Windows 첫 실행 작은 창의 숨김 영역 안내. 새 트레이 아이콘은 작업 표시줄의 숨김 영역에 들어간다. */
export function windowsTrayHint(appName: string): string {
  return `${appName} 아이콘은 작업 표시줄 오른쪽 ^ 안에 있습니다. 끌어서 꺼내 두면 검토할 초안이 있는지 보입니다.`;
}
