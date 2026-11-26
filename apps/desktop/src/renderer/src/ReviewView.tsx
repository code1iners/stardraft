import type { AppSnapshot, BundleSnapshot } from '../../shared/ipc';
import { BundleFooter, BundleSections, ManualTag, OpenInFlowButton, PostStatusLine, RunLine, StatusTag, ToastStack } from './BundleDetail';
import { GlobalProblemBanner } from './PopoverView';
import { EditorPickerModal } from './EditorPickerModal';
import { RepoPickerModal } from './RepoPickerModal';
import { ListKindGroup, ListRetentionNote, ListRow } from './ReviewList';
import { assignmentSourceText, BUNDLE_PLACE_LABELS, DRAFT_KIND_LABEL, formatTime, postLine, postTitleOf, senderLine } from './review-text';
import { useBundleActions, useBundleSelection } from './useReview';
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
 * 펼친 창 내용. 왼쪽 목록은 종류별로 묶고(상태는 줄의 태그로 보인다), 오른쪽에 고른 묶음의 상세를 모두 펼쳐 보인다.
 * "접어 보기"로 보고 있던 묶음을 연 작은 창으로 돌아간다.
 */
export function ReviewContent({ snapshot, initialBundleId = null }: ReviewContentProps) {
  /** 묶음 상태와 열린 저장소 선택 창. */
  const { bundles, sections, repoPicker } = snapshot.review;
  /** 고른 묶음. */
  const selection = useBundleSelection(bundles, initialBundleId);
  /** 보이는 묶음. */
  const { selected, select, movedWhileViewing } = selection;
  /** [무시]·[되돌리기]·[취소]·[다시 시도]·[게시]·[다시 게시]와 무시·게시 실패·멈춘 게시 토스트. */
  const { toast, failedToasts, stoppedToasts, followStopped, ignore, restore, cancel, retry, post, cancelPost } = useBundleActions(selection);

  /** 펼친 창을 닫고 작은 창으로 돌아간다. */
  const handleCollapse = () => {
    void window.stardraft.send({ type: 'collapse-review', bundleId: selected?.id ?? null });
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
                  <h2>{postTitleOf(selected)}</h2>
                  <div className="detail-meta">
                    <p className="review-meta">
                      {selected.projectTitle && <span>{selected.projectTitle}</span>}
                      <span>
                        {selected.assignment ? `${assignmentSourceText(selected)} · ${senderLine(selected.senderNames)}` : `${senderLine(selected.senderNames)}님이 ${BUNDLE_PLACE_LABELS[selected.place]}에서 멘션`}
                      </span>
                      <span>{formatTime(selected.lastMentionAt)}</span>
                    </p>
                    <OpenInFlowButton bundle={selected} />
                  </div>
                  <RunLine bundle={selected} />
                  <PostStatusLine bundle={selected} />
                </div>
                <ManualTag bundle={selected} />
                <StatusTag status={selected.status} repoCheck={selected.repoCheck} />
                <button type="button" className="btn sm" onClick={handleCollapse}>
                  접어 보기
                </button>
              </header>
              <main className="detail-body">
                <BundleSections bundle={selected} windowKind="expanded" sections={sections} movedWhileViewing={movedWhileViewing} />
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
              <header className="detail-head">
                <span className="spacer" />
                <button type="button" className="btn sm" onClick={handleCollapse}>
                  접어 보기
                </button>
              </header>
              <p className="detail-empty muted">{snapshot.review.bundles.some((bundle) => bundle.assignment) ? '검토할 초안이 없습니다.' : '아직 멘션이 없습니다.'}</p>
            </>
          )}
        </section>
      </div>
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

/**
 * 펼친 창 왼쪽 목록. 종류별로 묶어 이름과 개수를 단 머리 아래에 줄을 둔다. 지금은 Flow 초안 한 종류이고, 상태는 줄의 태그로만 보인다.
 * 행에는 송신자, 시각, 요구 요약(초안이 없으면 게시물), 태그를 보인다.
 * 끝낸 항목(처리됨)이 하나라도 있으면 목록 맨 아래에 보관 안내를 한 줄 둔다.
 */
function BundleList({ bundles, selectedId, onSelect }: BundleListProps) {
  return (
    <aside className="review-list">
      {bundles.length > 0 && (
        <ListKindGroup title={DRAFT_KIND_LABEL} count={bundles.length}>
          {bundles.map((bundle) => (
            <ListRow
              key={bundle.id}
              selected={bundle.id === selectedId}
              onSelect={() => onSelect(bundle.id)}
              title={senderLine(bundle.senderNames)}
              time={formatTime(bundle.lastMentionAt)}
              summary={bundle.draft?.requirement.summary || postLine(bundle)}
              tags={
                <>
                  {bundle.assignment && <span className="tag">{assignmentSourceText(bundle)}</span>}
                  <ManualTag bundle={bundle} />
                  <StatusTag status={bundle.status} repoCheck={bundle.repoCheck} />
                </>
              }
            />
          ))}
        </ListKindGroup>
      )}
      {bundles.some((bundle) => bundle.group === 'processed') && <ListRetentionNote />}
      {bundles.length === 0 && <p className="list-empty muted">아직 멘션이 없습니다.</p>}
    </aside>
  );
}
