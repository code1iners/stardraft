import type { TrayIndicator } from '../core/tray-indicator';

/** 단조 증가 시계와 취소할 수 있는 예약. */
export interface TrayAnimationClock {
  now(): number;
  after(delayMs: number, callback: () => void): () => void;
}

/** 시간 차이만 사용하여 시스템 시각 변경의 영향을 받지 않는다. */
const clock: TrayAnimationClock = {
  now: () => performance.now(),
  after: (delayMs, callback) => {
    /** 취소할 예약. */
    const timer = setTimeout(callback, delayMs);
    return () => clearTimeout(timer);
  },
};

/** 이미지를 새로 만들지 않고 상태와 미리 만든 프레임 번호만 고른다. */
export class TrayAnimation {
  /** 현재 아이콘 형태. */
  private kind: TrayIndicator['kind'] = 'idle';
  /** 동작 줄이기 설정. */
  private reduced = false;
  /** 절전 중에는 예약하지 않는다. */
  private suspended = false;
  /** 폐기 후의 알림을 무시한다. */
  private disposed = false;
  /** 현재 주기의 시작 시각. */
  private startedAt = 0;
  /** 프레임 예약 취소. */
  private cancelFrame: (() => void) | null = null;
  /** 설정 확인 예약 취소. */
  private cancelPreference: (() => void) | null = null;

  constructor(
    private readonly paint: (kind: TrayIndicator['kind'], frame: number) => void,
    private readonly prefersReducedMotion: () => boolean,
    private readonly time: TrayAnimationClock = clock,
  ) {}

  /** 같은 상태 재통지나 검토 수 변경은 주기를 다시 시작하지 않는다. */
  show(kind: TrayIndicator['kind']): void {
    if (this.disposed || this.kind === kind) return;
    this.stop();
    this.kind = kind;
    this.start();
  }

  /** 테마가 바뀌어도 현재 주기 위치를 유지한다. */
  refresh(): void {
    if (this.disposed) return;
    /** 반 주기의 20번 프레임은 완전한 채움이다. */
    const frame = this.reduced || this.suspended ? 20 : Math.floor((this.time.now() - this.startedAt) % 2000 / 50);
    this.paint(this.kind, frame);
  }

  /** 절전 중의 타이머를 멈춘다. */
  suspend(): void {
    if (this.disposed) return;
    this.suspended = true;
    this.stop();
  }

  /** 복귀 시 현재 설정으로 주기를 시작한다. */
  resume(): void {
    if (this.disposed || !this.suspended) return;
    this.suspended = false;
    this.start();
  }

  /** 모든 예약을 한 번만 취소한다. */
  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
  }

  /** 상태 전환·복귀 시에만 주기를 다시 시작한다. */
  private start(): void {
    this.startedAt = this.time.now();
    if (this.kind === 'review') this.reduced = this.prefersReducedMotion();
    this.refresh();
    if (this.kind !== 'review' || this.suspended) return;
    if (!this.reduced) this.scheduleFrame();
    this.schedulePreference();
  }

  /** 지연된 프레임은 시계를 기준으로 다시 고른다. */
  private scheduleFrame(): void {
    this.cancelFrame = this.time.after(50, () => {
      this.cancelFrame = null;
      this.refresh();
      this.scheduleFrame();
    });
  }

  /** 동작 줄이기를 해제했는지도 감지하도록 검토 상태에서만 설정을 읽는다. */
  private schedulePreference(): void {
    this.cancelPreference = this.time.after(1000, () => {
      this.cancelPreference = null;
      /** 현재 운영체제 설정. */
      const reduced = this.prefersReducedMotion();
      if (this.reduced !== reduced) {
        this.reduced = reduced;
        this.cancelFrame?.();
        this.cancelFrame = null;
        this.startedAt = this.time.now();
        this.refresh();
        if (!reduced) this.scheduleFrame();
      }
      this.schedulePreference();
    });
  }

  /** 검토 외 상태에는 실행 중인 타이머를 남기지 않는다. */
  private stop(): void {
    this.cancelFrame?.();
    this.cancelPreference?.();
    this.cancelFrame = null;
    this.cancelPreference = null;
  }
}
