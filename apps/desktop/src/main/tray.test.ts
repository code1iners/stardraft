import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** 실제 작업 표시줄 없이 구독과 표시 동작을 관찰한다. */
const mock = await vi.hoisted(async () => {
  /** 운영체제 이벤트를 흉내 낼 발행기. */
  const { EventEmitter } = await import('node:events');
  class FakeTray extends EventEmitter {
    setImage = vi.fn();
    setToolTip = vi.fn();
    setTitle = vi.fn();
    setIgnoreDoubleClickEvents = vi.fn();
    destroy = vi.fn();
    getBounds = vi.fn();
    popUpContextMenu = vi.fn();
  }
  return { FakeTray, theme: Object.assign(new EventEmitter(), { shouldUseDarkColorsForSystemIntegratedUI: false }), power: new EventEmitter(), reduced: false, trays: [] as FakeTray[] };
});
vi.mock('electron', () => ({
  app: { name: 'Stardraft' },
  Menu: { buildFromTemplate: vi.fn(items => items) },
  Tray: class extends mock.FakeTray { constructor() { super(); mock.trays.push(this); } },
  nativeTheme: mock.theme,
  powerMonitor: mock.power,
  systemPreferences: { getAnimationSettings: () => ({ prefersReducedMotion: mock.reduced }) },
}));
vi.mock('./tray-images', () => ({ TrayImages: class { get(kind: string, frame: number, dark: boolean) { return `${kind}:${frame}:${dark}`; } } }));
import { AppTray } from './tray';

beforeEach(() => { vi.useFakeTimers(); mock.trays.length = 0; mock.reduced = false; mock.theme.shouldUseDarkColorsForSystemIntegratedUI = false; });
afterEach(() => { mock.theme.removeAllListeners(); mock.power.removeAllListeners(); vi.useRealTimers(); });

describe('트레이 연결', () => {
  it('창 열기·수 변경은 상태를 지우지 않고 테마 변경은 같은 프레임을 다시 칠한다', () => {
    /** 사용자 동작은 상태를 읽는 쪽과 분리한다. */
    const togglePopover = vi.fn();
    const tray = new AppTray({ togglePopover, openPopover: vi.fn(), openSettings: vi.fn(), checkNow: vi.fn(), runUpdateAction: vi.fn(), quit: vi.fn() });
    const native = mock.trays[0]!;
    tray.show({ indicator: { kind: 'review', count: 3 }, problem: null, canCheckNow: true });
    expect(native.setToolTip).toHaveBeenLastCalledWith('Stardraft · 검토 대기 3건');
    vi.advanceTimersByTime(750);
    native.emit('click');
    expect(togglePopover).toHaveBeenCalledTimes(1);
    tray.show({ indicator: { kind: 'review', count: 12 }, problem: null, canCheckNow: true });
    expect(native.setToolTip).toHaveBeenLastCalledWith('Stardraft · 검토 대기 12건');
    mock.theme.shouldUseDarkColorsForSystemIntegratedUI = true;
    mock.theme.emit('updated');
    expect(native.setImage).toHaveBeenLastCalledWith('review:15:true');
    mock.power.emit('suspend');
    expect(vi.getTimerCount()).toBe(0);
    mock.power.emit('resume');
    expect(native.setImage).toHaveBeenLastCalledWith('review:0:true');
    tray.show({ indicator: { kind: 'problem', reason: 'failure' }, problem: null, canCheckNow: true });
    expect(native.setToolTip).toHaveBeenLastCalledWith('Stardraft · 실패 있음');
    expect(vi.getTimerCount()).toBe(0);
    tray.show({ indicator: { kind: 'idle', generating: true }, problem: null, canCheckNow: true });
    expect(native.setToolTip).toHaveBeenLastCalledWith('Stardraft · 초안 생성 중');
    tray.show({ indicator: { kind: 'review', count: 1 }, problem: null, canCheckNow: true });
    tray.destroy();
    tray.destroy();
    expect(native.destroy).toHaveBeenCalledTimes(1);
    expect(mock.theme.listenerCount('updated')).toBe(0);
    expect(mock.power.listenerCount('resume')).toBe(0);
    expect(mock.power.listenerCount('suspend')).toBe(0);
    native.setImage.mockClear();
    native.setToolTip.mockClear();
    tray.show({ indicator: { kind: 'review', count: 99 }, problem: null, canCheckNow: true });
    mock.theme.emit('updated');
    vi.advanceTimersByTime(5000);
    expect(native.setImage).not.toHaveBeenCalled();
    expect(native.setToolTip).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
