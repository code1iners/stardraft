import type { AppSnapshot, GlobalProblemSnapshot, SettingsSection } from './ipc';

/** 전역 문제를 띠, 트레이 메뉴, OS 알림에 보일 문구. 세 곳이 같은 문구를 쓴다. */
export interface GlobalProblemText {
  /** 짧은 이름. 트레이 메뉴 항목과 OS 알림 제목에 쓴다. */
  title: string;
  /** 원인을 적은 문장. 작은 창 띠와 OS 알림 본문에 쓴다. */
  message: string;
  /** 행동 버튼 이름. */
  actionLabel: string;
  /** 행동 버튼이 여는 설정 창의 칸. */
  actionSection: SettingsSection;
}

/** 전역 문제의 문구. 저장된 키를 읽을 수 없는 이유는 키를 지키는 곳(macOS 키체인, Windows DPAPI)이 달라 OS마다 다르게 적는다. */
export function globalProblemText(problem: GlobalProblemSnapshot, platform: AppSnapshot['platform']): GlobalProblemText {
  return {
    title: '키 확인 필요',
    message: problem.reason === 'rejected' ? KEY_REJECTED_MESSAGE : keyUnreadableMessage(platform),
    actionLabel: '키 다시 입력',
    actionSection: 'flow-account',
  };
}

/** Flow가 키를 거부했을 때(`401`)의 문구. */
const KEY_REJECTED_MESSAGE = 'Flow가 키를 거부했습니다. 키가 삭제됐거나 바뀌었을 수 있습니다.';

/** 저장된 키를 읽을 수 없을 때의 문구. Windows DPAPI는 같은 Windows 사용자 계정에서만 풀 수 있다. */
function keyUnreadableMessage(platform: AppSnapshot['platform']): string {
  if (platform === 'win32') {
    return '저장된 키를 읽을 수 없습니다. Windows 사용자 계정이 바뀌었거나 다른 PC에서 옮겨 온 데이터일 수 있습니다.';
  }
  return '저장된 키를 읽을 수 없습니다. 키체인 접근을 거부했거나 항목이 지워졌을 수 있습니다.';
}
