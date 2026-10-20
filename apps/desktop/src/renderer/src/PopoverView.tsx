import { useSnapshot } from './useSnapshot';

/** 트레이 아이콘을 누르면 뜨는 작은 창. 아직 보여 줄 멘션 묶음이 없는 빈 화면이다. */
export function PopoverView() {
  /** 앱 상태 스냅숏. */
  const snapshot = useSnapshot();

  /** 설정 창을 연다. 작은 창은 main이 닫는다. */
  const handleOpenSettings = () => {
    void window.stardraft.send({ type: 'open-settings' });
  };

  return (
    <div className="popover">
      <header className="popover-head">
        <strong>{snapshot?.appName ?? 'Stardraft'}</strong>
      </header>
      <main className="popover-body">
        <p className="muted">표시할 내용이 아직 없습니다.</p>
      </main>
      <footer className="popover-foot">
        <button type="button" className="btn" onClick={handleOpenSettings}>
          설정 열기
        </button>
      </footer>
    </div>
  );
}
