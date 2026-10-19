import type { AppNotification, Notifier } from '../ports/notifier';

/** 띄운 알림을 기록만 하는 알림 포트. */
export class RecordingNotifier implements Notifier {
  /** 띄운 알림. 띄운 순서대로 쌓인다. */
  readonly sent: AppNotification[] = [];

  notify(notification: AppNotification): void {
    this.sent.push(notification);
  }
}
