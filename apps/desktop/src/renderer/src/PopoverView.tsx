import { useEffect, useState, type ReactNode } from 'react';
import { globalProblemText } from '../../shared/global-problem-text';
import type { AppSnapshot, GlobalProblemSnapshot } from '../../shared/ipc';
import { BundleFooter, BundleMeta, BundleSections, ManualTag, StatusTag, ToastStack } from './BundleDetail';
import { DiagnosisBody, DiagnosisFooter, DiagnosisStatusTag } from './DiagnosisDetail';
import { SetupChecklist } from './Onboarding';
import { EditorPickerModal } from './EditorPickerModal';
import { RepoPickerModal } from './RepoPickerModal';
import { ManualCheckButton, ManualCheckModal } from './ManualCheck';
import { PopoverMenu } from './PopoverMenu';
import { RestartConfirm, UpdateBanner } from './UpdatePrompts';
import { useBundleActions, useBundleSelection } from './useReview';
import { useSnapshot } from './useSnapshot';

/** 작은 창에 넘기는 값. */
interface PopoverViewProps {
  /** 창을 열 때 고른 묶음 ID. OS 알림을 눌러 열었으면 그 묶음이다. 없으면 `null`. */
  initialBundleId: number | null;
  /** 창을 열 때 고른 진단 ID. 진단 알림을 눌러 열었으면 그 진단이다. 없으면 `null`. */
  initialDiagnosisId?: number | null;
}

/** 트레이 아이콘을 누르면 뜨는 작은 창. */
export function PopoverView({ initialBundleId, initialDiagnosisId = null }: PopoverViewProps) {
  /** 앱 상태 스냅숏. */
  const snapshot = useSnapshot();

  return snapshot ? (
    <PopoverContent snapshot={snapshot} initialBundleId={initialBundleId} initialDiagnosisId={initialDiagnosisId} />
  ) : (
    <div className="popover" />
  );
}

/** 작은 창 내용에 넘기는 값. */
interface PopoverContentProps {
  /** 앱 상태 스냅숏. */
  snapshot: AppSnapshot;
  /** 창을 열 때 고른 묶음 ID. 없으면 대기열 첫 묶음이다. */
  initialBundleId?: number | null;
  /** 창을 열 때 고른 진단 ID. 없으면 묶음을 보인다. */
  initialDiagnosisId?: number | null;
}

/**
 * 작은 창 내용. 맨 위 띠 자리 아래에, 감지를 시작하기 전이면 필수 설정 전 화면을,
 * 시작한 뒤면 멘션 묶음과 Sentry 진단을 하나씩 보인다. 보여 줄 것이 없으면 빈 화면이다.
 * 띠 자리는 하나이고 전역 문제 띠가 업데이트 띠보다 앞선다. macOS 다시 시작 확인 화면을 띄웠으면 그 화면만 보인다.
 */
export function PopoverContent({ snapshot, initialBundleId = null, initialDiagnosisId = null }: PopoverContentProps) {
  /** 앱 내 업데이트의 화면 상태. 소스 실행이면 `null`. */
  const update = snapshot.update;
  if (update?.restartConfirm) {
    return (
      <div className="popover">
        <RestartConfirm version={update.restartConfirm} appName={snapshot.appName} />
      </div>
    );
  }
  return (
    <div className="popover">
      {snapshot.globalProblem ? (
        <GlobalProblemBanner problem={snapshot.globalProblem} platform={snapshot.platform} />
      ) : (
        update && <UpdateBanner update={update} />
      )}
      {snapshot.onboarding.detectionStarted ? (
        <CompactReview snapshot={snapshot} initialBundleId={initialBundleId} initialDiagnosisId={initialDiagnosisId} />
      ) : (
        <>
          <header className="popover-head">
            <span className="popover-logo" aria-hidden="true" />
            <strong>{snapshot.appName}</strong>
            <span className="spacer" />
            <SettingsButton />
          </header>
          <SetupChecklist snapshot={snapshot} />
        </>
      )}
    </div>
  );
}

/** 작은 창의 대기열 보기에 넘기는 값. */
interface CompactReviewProps {
  /** 앱 상태 스냅숏. */
  snapshot: AppSnapshot;
  /** 창을 열 때 고른 묶음 ID. */
  initialBundleId: number | null;
  /** 창을 열 때 고른 진단 ID. */
  initialDiagnosisId: number | null;
}

/** 작은 창 대기열의 한 칸. 초안(멘션 묶음)이거나 진단이다. */
interface QueueItem {
  /** 종류. */
  kind: 'draft' | 'diagnosis';
  /** 그 종류 안의 ID. */
  id: number;
}

/**
 * 작은 창의 대기열 보기. 처리되지 않은 묶음을 가장 오래된 미처리 멘션 순으로, 그 뒤에 완료하지 않은 진단을 감지한 순서로 하나씩 보인다.
 * 진단도 초안과 같은 차례(`2 / 6`)에 들어가고, 머리에 `진단` 태그가 붙는다.
 * 머리에 대기열 위치, ‹ › 이동, 상태 태그, ⋯ 메뉴("최근 멘션 확인"·"펼쳐 보기")가 있고, 무시하면 다음 묶음으로 넘어간다.
 */
function CompactReview({ snapshot, initialBundleId, initialDiagnosisId }: CompactReviewProps) {
  /** 묶음과 진단 상태, 열린 저장소 선택 창. */
  const { bundles, diagnoses, sections, repoPicker } = snapshot.review;
  /** 고른 묶음과 대기열. */
  const selection = useBundleSelection(bundles, initialBundleId);
  /** 보이는 묶음과 대기열. */
  const { queue, movedWhileViewing } = selection;
  /** 고른 진단 ID. 묶음을 고르면 `null`이다. */
  const [diagnosisId, setDiagnosisId] = useState<number | null>(initialDiagnosisId);

  // 창이 떠 있는 동안 OS 알림을 눌러 main이 진단이나 묶음을 보내면 그 대상으로 바꾼다.
  useEffect(function followRequestedTarget() {
    return window.stardraft.onEvent((event) => {
      if (event.type === 'review-diagnosis-requested') setDiagnosisId(event.diagnosisId);
      if (event.type === 'review-bundle-requested') setDiagnosisId(null);
    });
  }, []);

  /** 대기열에 서는 진단. 완료함은 처리됨 묶음처럼 대기열에 없다. */
  const diagnosisQueue = diagnoses.filter((item) => item.status !== 'completed');
  /** 보이는 진단. 고른 진단이 목록에서 빠졌으면 묶음을 보이고, 고른 묶음도 없으면 첫 진단을 보인다. */
  const shownDiagnosis = diagnoses.find((item) => item.id === diagnosisId) ?? (selection.selected === null ? (diagnosisQueue[0] ?? null) : null);
  /** 보이는 묶음. 진단을 보이는 동안은 없다. */
  const selected = shownDiagnosis === null ? selection.selected : null;
  /** 묶음을 고른다. 묶음을 고르면 진단 선택은 풀어 그 묶음이 보이게 한다. */
  const select = (bundleId: number) => {
    setDiagnosisId(null);
    selection.select(bundleId);
  };
  /** [무시]·[되돌리기]·[취소]·[다시 시도]·[게시]·[다시 게시]와 무시·게시 실패·멈춘 게시 토스트. */
  const { toast, failedToasts, stoppedToasts, followStopped, ignore, restore, cancel, retry, post, cancelPost } = useBundleActions({
    select,
    leave: selection.leave,
  });
  /** 대기열 전체. 초안 뒤에 진단이 선다. */
  const items: QueueItem[] = [...queue.map((bundle): QueueItem => ({ kind: 'draft', id: bundle.id })), ...diagnosisQueue.map((item): QueueItem => ({ kind: 'diagnosis', id: item.id }))];
  /** 이동한 칸을 보인다. */
  const selectItem = (item: QueueItem) => (item.kind === 'draft' ? select(item.id) : setDiagnosisId(item.id));

  /** 펼친 창을 연다. 작은 창은 main이 닫는다. */
  const handleExpand = () => {
    void window.stardraft.send({ type: 'expand-review', bundleId: selected?.id ?? null, diagnosisId: shownDiagnosis?.id ?? null });
  };

  return (
    <>
      {shownDiagnosis ? (
        <>
          <QueueHead
            items={items}
            current={{ kind: 'diagnosis', id: shownDiagnosis.id }}
            tags={
              <>
                <span className="tag">진단</span>
                <DiagnosisStatusTag diagnosis={shownDiagnosis} />
              </>
            }
            manualCheck={snapshot.manualCheck}
            onSelect={selectItem}
            onExpand={handleExpand}
          />
          <DiagnosisBody diagnosis={shownDiagnosis} windowKind="compact" />
          <DiagnosisFooter diagnosis={shownDiagnosis} windowKind="compact" />
        </>
      ) : selected ? (
        <>
          <QueueHead
            items={items}
            current={{ kind: 'draft', id: selected.id }}
            tags={
              <>
                <ManualTag bundle={selected} />
                <StatusTag status={selected.status} repoCheck={selected.repoCheck} />
              </>
            }
            manualCheck={snapshot.manualCheck}
            onSelect={selectItem}
            onExpand={handleExpand}
          />
          <main className="popover-body review-body">
            <BundleMeta bundle={selected} />
            <BundleSections bundle={selected} windowKind="compact" sections={sections} movedWhileViewing={movedWhileViewing} />
          </main>
          <BundleFooter
            bundle={selected}
            onIgnore={() => ignore(selected)}
            onRestore={() => restore(selected.id)}
            onCancel={() => cancel(selected.id)}
            onRetry={() => retry(selected.id)}
            onPost={() => post(selected)}
            onCancelPost={() => cancelPost(selected.id)}
            windowKind="compact"
          />
        </>
      ) : (
        <>
          <header className="popover-head">
            <span className="popover-logo" aria-hidden="true" />
            <strong>{snapshot.appName}</strong>
            <span className="spacer" />
            <PopoverMenu manualCheck={snapshot.manualCheck} canExpand={bundles.length > 0} onExpand={handleExpand} />
            <SettingsButton />
          </header>
          <EmptyDetection snapshot={snapshot} />
        </>
      )}
      <ToastStack
        bundles={bundles}
        ignoreToast={toast}
        failedToasts={failedToasts}
        stoppedToasts={stoppedToasts}
        onRestore={restore}
        onCancelPost={cancelPost}
        onStoppedAction={followStopped}
      />
      {repoPicker && <RepoPickerModal picker={repoPicker} bundles={bundles} />}
      {snapshot.editor.picker && <EditorPickerModal picker={snapshot.editor.picker} />}
      {snapshot.manualCheck.sheet?.window === 'popover' && <ManualCheckModal sheet={snapshot.manualCheck.sheet} />}
    </>
  );
}

/** 작은 창 머리에 넘기는 값. */
interface QueueHeadProps {
  /** 작은 창 대기열. */
  items: readonly QueueItem[];
  /** 보이는 칸. */
  current: QueueItem;
  /** 상태 태그들. 초안은 수동 요청과 상태, 진단은 `진단`과 상태다. */
  tags: ReactNode;
  /** 최근 멘션 확인 상태. ⋯ 메뉴 항목이 막혔는지 가른다. */
  manualCheck: AppSnapshot['manualCheck'];
  /** 칸을 고른다. */
  onSelect: (item: QueueItem) => void;
  /** 메뉴에서 "펼쳐 보기"를 골랐다. */
  onExpand: () => void;
}

/**
 * 작은 창 머리. 대기열 위치(`3 / 4`), ‹ › 이동, 상태 태그, ⋯ 메뉴다.
 * 처리됨 묶음이나 완료한 진단을 보고 있으면 위치 대신 "처리한 묶음"·"완료한 진단"이다.
 */
function QueueHead({ items, current, tags, manualCheck, onSelect, onExpand }: QueueHeadProps) {
  /** 보이는 칸의 대기열 위치. 대기열에 없으면 -1. */
  const index = items.findIndex((item) => item.kind === current.kind && item.id === current.id);
  /** 앞 칸과 다음 칸. */
  const [previous, next] = index >= 0 ? [items[index - 1], items[index + 1]] : [undefined, undefined];

  return (
    <header className="review-head">
      <button type="button" className="nav-btn" aria-label="앞 항목" disabled={!previous} onClick={() => previous && onSelect(previous)}>
        ‹
      </button>
      <button type="button" className="nav-btn" aria-label="다음 항목" disabled={!next} onClick={() => next && onSelect(next)}>
        ›
      </button>
      <span className="queue-pos">{index >= 0 ? `${index + 1} / ${items.length}` : current.kind === 'diagnosis' ? '완료한 진단' : '처리한 묶음'}</span>
      <span className="spacer" />
      {tags}
      <PopoverMenu manualCheck={manualCheck} canExpand onExpand={onExpand} />
    </header>
  );
}

/** 빈 화면에 넘기는 값. */
interface EmptyDetectionProps {
  /** 앱 상태 스냅숏. */
  snapshot: AppSnapshot;
}

/** 감지 중 묶음이 없을 때의 빈 화면. [최근 멘션 확인]을 누르면 이 창에 확인 창를 연다. */
function EmptyDetection({ snapshot }: EmptyDetectionProps) {
  return (
    <>
      <main className="popover-body popover-empty">
        <p>
          <strong>아직 멘션이 없습니다.</strong>
        </p>
        <p className="small muted">새 멘션이 오면 초안을 만들어 여기에 보여 드립니다.</p>
        <ManualCheckButton manualCheck={snapshot.manualCheck} window="popover" noteClassName="small muted" />
      </main>
    </>
  );
}

/** 트레이 제목 오른쪽에서 설정 창을 여는 아이콘 버튼. */
function SettingsButton() {
  return (
    <button
      type="button"
      className="popover-settings"
      aria-label="설정 열기"
      title="설정 열기"
      onClick={() => void window.stardraft.send({ type: 'open-settings' })}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9.7 4.3 10.3 2h3.4l.6 2.3 2 1.2 2.3-.6 1.7 2.9-1.7 1.7v2.4l1.7 1.7-1.7 2.9-2.3-.6-2 1.2-.6 2.3h-3.4l-.6-2.3-2-1.2-2.3.6-1.7-2.9 1.7-1.7V9.5L3.7 7.8l1.7-2.9 2.3.6Z" transform="translate(0 1.3)" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    </button>
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
