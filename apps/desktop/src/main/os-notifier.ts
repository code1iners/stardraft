import { Notification } from 'electron';
import type { Logger } from '../core/logging/logger';
import type { AppNotification, Notifier } from '../core/ports/notifier';

/**
 * Electron `Notification`으로 OS 알림을 띄우는 알림 포트.
 * OS 알림은 보조 수단이라, 띄우지 못해도 로그만 남기고 트레이 표시로 동작을 이어 간다.
 */
export class OsNotifier implements Notifier {
  /**
   * 화면이나 알림 센터에 남아 있는 알림. 객체가 가비지 컬렉션되면 macOS는 알림 센터에서 지우고 클릭도 전달하지 않으므로,
   * 사용자가 닫을 때까지 붙잡아 둔다.
   */
  private readonly shown = new Set<Notification>();
  /** 마지막으로 띄운 멘션 묶음 알림의 묶음 ID. Windows 전역 처리기가 쓴다. */
  private lastBundleId: number | null = null;

  /** `onActivate`는 알림을 눌렀을 때 그 알림이 가리키는 멘션 묶음 ID(없으면 `null`)로 부른다. */
  constructor(
    private readonly onActivate: (bundleId: number | null) => void,
    private readonly logger: Logger,
  ) {
    // Windows는 알림 센터에 남은 알림이나 객체가 사라진 뒤의 클릭도 받도록 전역 처리기를 쓴다.
    // 객체의 click 이벤트와 함께 불리므로 Windows에서는 click 이벤트를 따로 달지 않는다.
    // 전역 처리기는 어느 알림을 눌렀는지 알려 주지 않으므로 마지막으로 띄운 묶음 알림의 묶음을 연다(실기 미확인).
    // 그 뒤에 전역 문제 알림이 와도 덮어쓰지 않는다. 전역 문제는 작은 창 맨 위 띠에 함께 보인다.
    if (process.platform === 'win32') Notification.handleActivation(() => this.onActivate(this.lastBundleId));
  }

  notify({ title, body, bundleId }: AppNotification): void {
    if (!Notification.isSupported()) {
      this.logger.warn('notification.unsupported');
      return;
    }

    /** 띄울 알림. */
    const notification = new Notification({ title, body });
    this.shown.add(notification);
    if (bundleId !== undefined) this.lastBundleId = bundleId;
    if (process.platform !== 'win32') notification.on('click', () => this.onActivate(bundleId ?? null));
    notification.on('close', () => this.shown.delete(notification));
    notification.on('failed', (_event, error) => {
      this.shown.delete(notification);
      this.logger.warn('notification.failed', { errorMessage: error });
    });
    notification.show();
  }
}
