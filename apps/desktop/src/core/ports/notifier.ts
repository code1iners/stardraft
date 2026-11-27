/**
 * 알림이 가리키는 대상. 종류와 대상 ID다. 알림을 누르면 그 대상을 작은 창에 연다.
 * 종류는 Flow 초안(`draft`, 멘션 묶음 ID)과 Sentry 진단(`diagnosis`, 진단 ID)이다.
 */
export interface NotificationTarget {
  /** 대상의 종류. */
  kind: 'draft' | 'diagnosis';
  /** 그 종류 안에서의 대상 ID. */
  id: number;
}

/** OS 알림 한 건. */
export interface AppNotification {
  /** 제목. */
  title: string;
  /** 본문. Flow 글 본문과 오류 내용은 넣지 않는다. */
  body: string;
  /** 알림을 누르면 작은 창에 열 대상. 없으면 작은 창만 띄운다. */
  target?: NotificationTarget;
}

/** 알림 포트. OS 알림은 보조 수단이라 보낸 뒤 결과를 기다리지 않는다. */
export interface Notifier {
  /** OS 알림을 띄운다. */
  notify(notification: AppNotification): void;
}
