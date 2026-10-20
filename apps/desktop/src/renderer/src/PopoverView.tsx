import { globalProblemText } from '../../shared/global-problem-text';
import type { AppSnapshot, GlobalProblemSnapshot } from '../../shared/ipc';
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
      {snapshot?.globalProblem && <GlobalProblemBanner problem={snapshot.globalProblem} platform={snapshot.platform} />}
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

/** 전역 문제 띠에 넘기는 값. */
interface GlobalProblemBannerProps {
  /** 보일 전역 문제. */
  problem: GlobalProblemSnapshot;
  /** 실행 중인 OS. 키를 지키는 곳에 맞춰 문구가 다르다. */
  platform: AppSnapshot['platform'];
}

/** 작은 창 맨 위 띠. 띠 자리는 하나이고 전역 문제가 맨 앞이다. 원인과 행동 버튼 하나를 보인다. */
function GlobalProblemBanner({ problem, platform }: GlobalProblemBannerProps) {
  /** 원인 문장과 행동 버튼. */
  const text = globalProblemText(problem, platform);

  /** 행동 버튼이 가리키는 설정 칸을 연다. 작은 창은 main이 닫는다. */
  const handleAction = () => {
    void window.stardraft.send({ type: 'open-settings', section: text.actionSection });
  };

  return (
    <div className="problem-banner" role="alert">
      <p>{text.message}</p>
      <button type="button" className="btn sm" onClick={handleAction}>
        {text.actionLabel}
      </button>
    </div>
  );
}
