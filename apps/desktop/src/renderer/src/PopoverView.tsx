import { globalProblemText } from '../../shared/global-problem-text';
import type { AppSnapshot, BundleSnapshot, GlobalProblemSnapshot } from '../../shared/ipc';
import { BundleFooter, BundleMeta, BundleSections, StatusTag, ToastStack } from './BundleDetail';
import { SetupChecklist, WindowsTrayHint } from './Onboarding';
import { EditorPickerSheet } from './EditorPickerSheet';
import { RepoPickerSheet } from './RepoPickerSheet';
import { useBundleActions, useBundleSelection } from './useReview';
import { useSnapshot } from './useSnapshot';

/** 작은 창에 넘기는 값. */
interface PopoverViewProps {
  /** 창을 열 때 고른 묶음 ID. OS 알림을 눌러 열었으면 그 묶음이다. 없으면 `null`. */
  initialBundleId: number | null;
}

/** 트레이 아이콘을 누르면 뜨는 작은 창. */
export function PopoverView({ initialBundleId }: PopoverViewProps) {
  /** 앱 상태 스냅숏. */
  const snapshot = useSnapshot();

  return snapshot ? <PopoverContent snapshot={snapshot} initialBundleId={initialBundleId} /> : <div className="popover" />;
}

/** 작은 창 내용에 넘기는 값. */
interface PopoverContentProps {
  /** 앱 상태 스냅숏. */
  snapshot: AppSnapshot;
  /** 창을 열 때 고른 묶음 ID. 없으면 대기열 첫 묶음이다. */
  initialBundleId?: number | null;
}

/**
 * 작은 창 내용. 맨 위 띠 자리 아래에, 감지를 시작하기 전이면 필수 설정 전 화면을,
 * 시작한 뒤면 멘션 묶음을 하나씩 보인다. 보여 줄 묶음이 없으면 빈 화면이다.
 */
export function PopoverContent({ snapshot, initialBundleId = null }: PopoverContentProps) {
  return (
    <div className="popover">
      {snapshot.globalProblem && <GlobalProblemBanner problem={snapshot.globalProblem} platform={snapshot.platform} />}
      {snapshot.onboarding.detectionStarted ? (
        <CompactReview snapshot={snapshot} initialBundleId={initialBundleId} />
      ) : (
        <>
          <header className="popover-head">
            <strong>{snapshot.appName}</strong>
          </header>
          <SetupChecklist snapshot={snapshot} />
        </>
      )}
    </div>
  );
}

/** 작은 창의 묶음 보기에 넘기는 값. */
interface CompactReviewProps {
  /** 앱 상태 스냅숏. */
  snapshot: AppSnapshot;
  /** 창을 열 때 고른 묶음 ID. */
  initialBundleId: number | null;
}

/**
 * 작은 창의 묶음 보기. 처리되지 않은 묶음을 가장 오래된 미처리 멘션 순으로 하나씩 보인다.
 * 머리에 대기열 위치, ‹ › 이동, 상태 태그, "펼쳐 보기"가 있고, 무시하면 다음 묶음으로 넘어간다.
 */
function CompactReview({ snapshot, initialBundleId }: CompactReviewProps) {
  /** 묶음 상태와 열린 저장소 선택 창. */
  const { bundles, sections, repoPicker } = snapshot.review;
  /** 고른 묶음과 대기열. */
  const selection = useBundleSelection(bundles, initialBundleId);
  /** 보이는 묶음과 대기열. */
  const { queue, selected, select } = selection;
  /** [무시]·[되돌리기]·[취소]·[다시 시도]·[게시]·[다시 게시]와 무시·게시 실패 토스트. */
  const { toast, failedToasts, ignore, restore, cancel, retry, post, cancelPost } = useBundleActions(selection);

  /** 펼친 창을 연다. 작은 창은 main이 닫는다. */
  const handleExpand = () => {
    void window.stardraft.send({ type: 'expand-review', bundleId: selected?.id ?? null });
  };

  return (
    <>
      {selected ? (
        <>
          <QueueHead queue={queue} selected={selected} onSelect={select} onExpand={handleExpand} />
          <main className="popover-body review-body">
            <BundleMeta bundle={selected} />
            <BundleSections bundle={selected} windowKind="compact" sections={sections} />
          </main>
          <BundleFooter
            bundle={selected}
            onIgnore={() => ignore(selected)}
            onRestore={() => restore(selected.id)}
            onCancel={() => cancel(selected.id)}
            onRetry={() => retry(selected.id)}
            onPost={() => post(selected)}
            onCancelPost={() => cancelPost(selected.id)}
          />
        </>
      ) : (
        <>
          <header className="popover-head">
            <strong>{snapshot.appName}</strong>
            <span className="spacer" />
            {bundles.length > 0 && (
              <button type="button" className="btn sm" onClick={handleExpand}>
                펼쳐 보기
              </button>
            )}
          </header>
          <EmptyDetection snapshot={snapshot} />
        </>
      )}
      <ToastStack bundles={bundles} ignoreToast={toast} failedToasts={failedToasts} onRestore={restore} onCancelPost={cancelPost} />
      {repoPicker && <RepoPickerSheet picker={repoPicker} bundles={bundles} />}
      {snapshot.editor.picker && <EditorPickerSheet picker={snapshot.editor.picker} />}
    </>
  );
}

/** 작은 창 머리에 넘기는 값. */
interface QueueHeadProps {
  /** 작은 창 대기열. */
  queue: readonly BundleSnapshot[];
  /** 보이는 묶음. */
  selected: BundleSnapshot;
  /** 묶음을 고른다. */
  onSelect: (bundleId: number) => void;
  /** "펼쳐 보기"를 눌렀다. */
  onExpand: () => void;
}

/** 작은 창 머리. 대기열 위치(`3 / 4`), ‹ › 이동, 상태 태그, "펼쳐 보기"다. 처리됨 묶음을 보고 있으면 위치 대신 "처리한 묶음"이다. */
function QueueHead({ queue, selected, onSelect, onExpand }: QueueHeadProps) {
  /** 보이는 묶음의 대기열 위치. 처리됨 묶음이면 -1. */
  const index = queue.findIndex((bundle) => bundle.id === selected.id);
  /** 앞 묶음과 다음 묶음. */
  const [previous, next] = index >= 0 ? [queue[index - 1], queue[index + 1]] : [undefined, undefined];

  return (
    <header className="review-head">
      <button type="button" className="nav-btn" aria-label="앞 묶음" disabled={!previous} onClick={() => previous && onSelect(previous.id)}>
        ‹
      </button>
      <button type="button" className="nav-btn" aria-label="다음 묶음" disabled={!next} onClick={() => next && onSelect(next.id)}>
        ›
      </button>
      <span className="queue-pos">{index >= 0 ? `${index + 1} / ${queue.length}` : '처리한 묶음'}</span>
      <span className="spacer" />
      <StatusTag status={selected.status} />
      <button type="button" className="btn sm" onClick={onExpand}>
        펼쳐 보기
      </button>
    </header>
  );
}

/** 빈 화면에 넘기는 값. */
interface EmptyDetectionProps {
  /** 앱 상태 스냅숏. */
  snapshot: AppSnapshot;
}

/** 감지 중 묶음이 없을 때의 빈 화면. [최근 멘션으로 시험]은 시험 기능을 더하는 티켓이 연결한다. */
function EmptyDetection({ snapshot }: EmptyDetectionProps) {
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
        <WindowsTrayHint snapshot={snapshot} />
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

/** 창 맨 위 띠. 띠 자리는 하나이고 전역 문제가 맨 앞이다. 원인과 행동 버튼 하나를 보인다. */
export function GlobalProblemBanner({ problem, platform }: GlobalProblemBannerProps) {
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
