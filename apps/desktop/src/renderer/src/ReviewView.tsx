import { BUNDLE_GROUPS, type AppSnapshot, type BundleSnapshot } from '../../shared/ipc';
import { BundleFooter, BundleSections, IgnoreToast, ignoredText, OpenInFlowButton, postLine, StatusTag } from './BundleDetail';
import { GlobalProblemBanner } from './PopoverView';
import { BUNDLE_GROUP_LABELS, formatMentionTime, RETENTION_NOTE, senderLine } from './review-text';
import { useBundleSelection, useIgnoreToast } from './useReview';
import { useSnapshot } from './useSnapshot';

/** 펼친 창에 넘기는 값. */
interface ReviewViewProps {
  /** 창을 열 때 고른 묶음 ID. 작은 창에서 보고 있던 묶음이다. 없으면 `null`. */
  initialBundleId: number | null;
}

/** 작은 창의 "펼쳐 보기"로 여는 목록+상세 창. */
export function ReviewView({ initialBundleId }: ReviewViewProps) {
  /** 앱 상태 스냅숏. */
  const snapshot = useSnapshot();

  return snapshot ? <ReviewContent snapshot={snapshot} initialBundleId={initialBundleId} /> : <div className="review-window" />;
}

/** 펼친 창 내용에 넘기는 값. */
interface ReviewContentProps {
  /** 앱 상태 스냅숏. */
  snapshot: AppSnapshot;
  /** 창을 열 때 고른 묶음 ID. 없으면 대기열 첫 묶음이다. */
  initialBundleId?: number | null;
}

/**
 * 펼친 창 내용. 왼쪽 목록은 검토 대기·생성 중·실패·처리됨으로 묶고, 오른쪽에 고른 묶음의 상세를 모두 펼쳐 보인다.
 * "접어 보기"로 보고 있던 묶음을 연 작은 창으로 돌아간다.
 */
export function ReviewContent({ snapshot, initialBundleId = null }: ReviewContentProps) {
  /** 묶음 상태. */
  const { bundles, sections } = snapshot.review;
  /** 고른 묶음. */
  const { selected, select, leave } = useBundleSelection(bundles, initialBundleId);
  /** 무시 토스트. */
  const [toast, setToast] = useIgnoreToast();

  /** 펼친 창을 닫고 작은 창으로 돌아간다. */
  const handleCollapse = () => {
    void window.stardraft.send({ type: 'collapse-review', bundleId: selected?.id ?? null });
  };
  /** 묶음을 무시하고 다음 묶음으로 넘어간다. */
  const handleIgnore = (bundle: BundleSnapshot) => {
    leave(bundle.id);
    setToast({ bundleId: bundle.id, text: ignoredText(bundle) });
    void window.stardraft.send({ type: 'ignore-bundle', bundleId: bundle.id });
  };
  /** 묶음을 되돌리고 그 묶음을 보인다. */
  const handleRestore = (bundleId: number) => {
    setToast(null);
    select(bundleId);
    void window.stardraft.send({ type: 'restore-bundle', bundleId });
  };

  return (
    <div className="review-window">
      {snapshot.globalProblem && <GlobalProblemBanner problem={snapshot.globalProblem} platform={snapshot.platform} />}
      <div className="review-layout">
        <BundleList bundles={bundles} selectedId={selected?.id ?? null} onSelect={select} />
        <section className="review-detail">
          {selected ? (
            <>
              <header className="detail-head">
                <div className="detail-title">
                  <h2>{selected.postTitle || '제목 없는 게시물'}</h2>
                  <div className="detail-meta">
                    <p className="review-meta">
                      {selected.projectTitle && <span>{selected.projectTitle}</span>}
                      <span>
                        {senderLine(selected.senderNames)}님이 {selected.place === 'post' ? '본문' : '댓글'}에서 멘션
                      </span>
                      <span>{formatMentionTime(selected.lastMentionAt)}</span>
                    </p>
                    <OpenInFlowButton bundle={selected} />
                  </div>
                </div>
                <StatusTag status={selected.status} />
                <button type="button" className="btn sm" onClick={handleCollapse}>
                  접어 보기
                </button>
              </header>
              <main className="detail-body">
                <BundleSections bundle={selected} kind="expanded" sections={sections} />
              </main>
              <BundleFooter bundle={selected} onIgnore={() => handleIgnore(selected)} onRestore={() => handleRestore(selected.id)} />
            </>
          ) : (
            <>
              <header className="detail-head">
                <span className="spacer" />
                <button type="button" className="btn sm" onClick={handleCollapse}>
                  접어 보기
                </button>
              </header>
              <p className="detail-empty muted">아직 멘션이 없습니다.</p>
            </>
          )}
        </section>
      </div>
      {toast && <IgnoreToast toast={toast} onRestore={() => handleRestore(toast.bundleId)} />}
    </div>
  );
}

/** 목록에 넘기는 값. */
interface BundleListProps {
  /** 묶음 전부. main이 정한 순서다. */
  bundles: readonly BundleSnapshot[];
  /** 고른 묶음 ID. */
  selectedId: number | null;
  /** 묶음을 고른다. */
  onSelect: (bundleId: number) => void;
}

/** 펼친 창 왼쪽 목록. 비어 있지 않은 묶음만 이름과 개수를 달아 보이고, 처리됨 아래에 보관 안내를 둔다. */
function BundleList({ bundles, selectedId, onSelect }: BundleListProps) {
  return (
    <aside className="review-list">
      {BUNDLE_GROUPS.map((group) => {
        /** 이 묶음에 든 멘션 묶음. */
        const items = bundles.filter((bundle) => bundle.group === group);
        if (items.length === 0) return null;
        return (
          <section key={group}>
            <h3 className="list-group-head">
              {BUNDLE_GROUP_LABELS[group]} {items.length}
            </h3>
            {items.map((bundle) => (
              <button
                key={bundle.id}
                type="button"
                className="list-row"
                aria-current={bundle.id === selectedId ? 'true' : undefined}
                onClick={() => onSelect(bundle.id)}
              >
                <span className="list-row-top">
                  <strong>{senderLine(bundle.senderNames)}</strong>
                  <span className="small muted">{formatMentionTime(bundle.lastMentionAt)}</span>
                </span>
                <span className="list-row-sub">{postLine(bundle)}</span>
                <StatusTag status={bundle.status} />
              </button>
            ))}
            {group === 'processed' && <p className="list-note">{RETENTION_NOTE}</p>}
          </section>
        );
      })}
      {bundles.length === 0 && <p className="list-empty muted">아직 멘션이 없습니다.</p>}
    </aside>
  );
}
