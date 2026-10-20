import { globalProblemText } from '../../shared/global-problem-text';
import type { AppSnapshot, GlobalProblemSnapshot } from '../../shared/ipc';
import { SetupChecklist } from './Onboarding';
import { useSnapshot } from './useSnapshot';

/** 트레이 아이콘을 누르면 뜨는 작은 창. */
export function PopoverView() {
  /** 앱 상태 스냅숏. */
  const snapshot = useSnapshot();

  return snapshot ? <PopoverContent snapshot={snapshot} /> : <div className="popover" />;
}

/** 작은 창 내용에 넘기는 값. */
interface PopoverContentProps {
  /** 앱 상태 스냅숏. */
  snapshot: AppSnapshot;
}

/**
 * 작은 창 내용. 맨 위 띠 자리 아래에, 감지를 시작하기 전이면 필수 설정 전 화면을,
 * 시작한 뒤 보여 줄 멘션 묶음이 없으면 빈 화면을 보인다.
 */
export function PopoverContent({ snapshot }: PopoverContentProps) {
  return (
    <div className="popover">
      {snapshot.globalProblem && <GlobalProblemBanner problem={snapshot.globalProblem} platform={snapshot.platform} />}
      <header className="popover-head">
        <strong>{snapshot.appName}</strong>
      </header>
      {snapshot.onboarding.detectionStarted ? <EmptyDetection /> : <SetupChecklist snapshot={snapshot} />}
    </div>
  );
}

/** 감지 중 묶음이 없을 때의 빈 화면. [최근 멘션으로 시험]은 시험 기능을 더하는 티켓이 연결한다. */
function EmptyDetection() {
  /** 설정 창을 연다. 작은 창은 main이 닫는다. */
  const handleOpenSettings = () => {
    void window.stardraft.send({ type: 'open-settings' });
  };

  return (
    <>
      <main className="popover-body popover-empty">
        <p>
          <strong>아직 멘션이 없습니다.</strong>
        </p>
        <p className="small muted">새 멘션이 오면 초안을 만들어 여기에 보여 드립니다.</p>
        <button type="button" className="btn" disabled>
          최근 멘션으로 시험
        </button>
        <p className="small muted">지난 멘션 하나로 앱이 동작하는지 확인합니다. Flow에는 아무것도 올리지 않습니다.</p>
      </main>
      <footer className="popover-foot">
        <button type="button" className="btn" onClick={handleOpenSettings}>
          설정 열기
        </button>
      </footer>
    </>
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
