/** OS 알림 한 건. */
export interface AppNotification {
  /** 제목. */
  title: string;
  /** 본문. Flow 글 본문은 넣지 않는다. */
  body: string;
  /** 알림을 누르면 작은 창에 열 멘션 묶음의 ID. 없으면 작은 창만 띄운다. */
  bundleId?: number;
}

/** 알림 포트. OS 알림은 보조 수단이라 보낸 뒤 결과를 기다리지 않는다. */
export interface Notifier {
  /** OS 알림을 띄운다. */
  notify(notification: AppNotification): void;
}
