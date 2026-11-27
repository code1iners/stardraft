import { useEffect, useState } from 'react';
import type { AppSnapshot, BundleSnapshot, DiagnosisSnapshot } from '../../shared/ipc';
import { BundleFooter, BundleSections, ManualTag, OpenInFlowButton, PostStatusLine, RunLine, StatusTag, ToastStack } from './BundleDetail';
import { GlobalProblemBanner } from './PopoverView';
import { EditorPickerModal } from './EditorPickerModal';
import { RepoPickerModal } from './RepoPickerModal';
import { DiagnosisBody, DiagnosisFooter, DiagnosisHead, DiagnosisStatusTag, ReproductionTag, useDirectivePane } from './DiagnosisDetail';
import { DIAGNOSIS_KIND_LABEL, diagnosisPlaceLine } from './diagnosis-text';
import { ListKindGroup, ListRetentionNote, ListRow } from './ReviewList';
import { assignmentSourceText, BUNDLE_PLACE_LABELS, DRAFT_KIND_LABEL, formatTime, postLine, postTitleOf, senderLine } from './review-text';
import { useBundleActions, useBundleSelection } from './useReview';
import { useSnapshot } from './useSnapshot';

/** 펼친 창에 넘기는 값. */
interface ReviewViewProps {
  /** 창을 열 때 고른 묶음 ID. 작은 창에서 보고 있던 묶음이다. 없으면 `null`. */
  initialBundleId: number | null;
  /** 창을 열 때 고른 진단 ID. 진단 알림을 눌러 열었을 때다. 없으면 `null`. */
  initialDiagnosisId?: number | null;
}

/** 작은 창의 "펼쳐 보기"로 여는 목록+상세 창. */
export function ReviewView({ initialBundleId, initialDiagnosisId = null }: ReviewViewProps) {
  /** 앱 상태 스냅숏. */
  const snapshot = useSnapshot();

  return snapshot ? (
    <ReviewContent snapshot={snapshot} initialBundleId={initialBundleId} initialDiagnosisId={initialDiagnosisId} />
  ) : (
    <div className="review-window" />
  );
}

/** 펼친 창 내용에 넘기는 값. */
interface ReviewContentProps {
  /** 앱 상태 스냅숏. */
  snapshot: AppSnapshot;
  /** 창을 열 때 고른 묶음 ID. 없으면 대기열 첫 묶음이다. */
  initialBundleId?: number | null;
  /** 창을 열 때 고른 진단 ID. 없으면 묶음을 보인다. */
  initialDiagnosisId?: number | null;
}

/**
 * 펼친 창 내용. 왼쪽 목록은 종류별로 묶고(상태는 줄의 태그로 보인다), 오른쪽에 고른 묶음의 상세를 모두 펼쳐 보인다.
 * "접어 보기"로 보고 있던 묶음을 연 작은 창으로 돌아간다.
 */
export function ReviewContent({ snapshot, initialBundleId = null, initialDiagnosisId = null }: ReviewContentProps) {
  /** 묶음과 진단 상태, 열린 저장소 선택 창. */
  const { bundles, diagnoses, sections, repoPicker } = snapshot.review;
  /** 고른 묶음. */
  const selection = useBundleSelection(bundles, initialBundleId);
  /** 보이는 묶음이 보는 사이 처리됨으로 옮겨졌는지 여부. */
  const { movedWhileViewing } = selection;
  /** 고른 진단 ID. 묶음을 고르면 `null`이다. */
  const [diagnosisId, setDiagnosisId] = useState<number | null>(initialDiagnosisId);
  /** 진단의 지시 입력. 보고서 위 알림 줄과 바닥 줄이 함께 쓴다. */
  const directivePane = useDirectivePane();

  useEffect(function followRequestedDiagnosis() {
    return window.stardraft.onEvent((event) => {
      if (event.type === 'review-diagnosis-requested') setDiagnosisId(event.diagnosisId);
      if (event.type === 'review-bundle-requested') setDiagnosisId(null);
    });
  }, []);

  /** 보이는 진단. 고른 진단이 목록에서 빠졌으면 묶음을 보이고, 고른 묶음도 없으면 첫 진단을 보인다. */
  const shownDiagnosis = diagnoses.find((item) => item.id === diagnosisId) ?? (selection.selected === null ? (diagnoses[0] ?? null) : null);
  /** 보이는 묶음. 진단을 보이는 동안은 없다. */
  const selected = shownDiagnosis === null ? selection.selected : null;
  /** 묶음을 고른다. 목록 줄과 토스트가 묶음을 고르면 진단 선택은 풀어 그 묶음이 보이게 한다. */
  const select = (bundleId: number) => {
    setDiagnosisId(null);
    selection.select(bundleId);
  };
  /** [무시]·[되돌리기]·[취소]·[다시 시도]·[게시]·[다시 게시]와 무시·게시 실패·멈춘 게시 토스트. */
  const { toast, failedToasts, stoppedToasts, exportToasts, followStopped, ignore, restore, cancel, retry, post, cancelPost } = useBundleActions({
    select,
    leave: selection.leave,
  });

  /** 펼친 창을 닫고 작은 창으로 돌아간다. */
  const handleCollapse = () => {
    void window.stardraft.send({ type: 'collapse-review', bundleId: selected?.id ?? null, diagnosisId: shownDiagnosis?.id ?? null });
  };

  return (
    <div className="review-window">
      {snapshot.globalProblem && <GlobalProblemBanner problem={snapshot.globalProblem} platform={snapshot.platform} />}
      <div className="review-layout">
        <aside className="review-list">
          <DiagnosisList diagnoses={diagnoses} selectedId={shownDiagnosis?.id ?? null} onSelect={setDiagnosisId} />
          <BundleList bundles={bundles} selectedId={selected?.id ?? null} onSelect={select} />
          {(bundles.some((bundle) => bundle.group === 'processed') || diagnoses.some((diagnosis) => diagnosis.status === 'completed')) && <ListRetentionNote />}
          {bundles.length === 0 && diagnoses.length === 0 && <p className="list-empty muted">아직 멘션이 없습니다.</p>}
        </aside>
        <section className="review-detail">
          {shownDiagnosis ? (
            <>
              <DiagnosisHead diagnosis={shownDiagnosis} onCollapse={handleCollapse} />
              <DiagnosisBody diagnosis={shownDiagnosis} directivePane={directivePane} />
              <DiagnosisFooter diagnosis={shownDiagnosis} directivePane={directivePane} />
            </>
          ) : selected ? (
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
        exportToasts={exportToasts}
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

/** 진단 목록에 넘기는 값. */
interface DiagnosisListProps {
  /** 진단 전부. 감지한 순서다. */
  diagnoses: readonly DiagnosisSnapshot[];
  /** 고른 진단 ID. */
  selectedId: number | null;
  /** 진단을 고른다. */
  onSelect: (diagnosisId: number) => void;
}

/**
 * 펼친 창 목록의 `진단 n` 묶음. 초안 묶음보다 위에 둔다. 줄에는 오류 제목, 감지 시각, 보고서 요약(보고서가 없으면 `프로젝트 · 자리`), 재현 태그(보고서가 있을 때)와 상태 태그를 보인다.
 * 같은 오류 이슈의 진단이 둘이면 각각 한 줄이고 감지 시각으로 구분된다.
 */
function DiagnosisList({ diagnoses, selectedId, onSelect }: DiagnosisListProps) {
  if (diagnoses.length === 0) return null;
  return (
    <ListKindGroup title={DIAGNOSIS_KIND_LABEL} count={diagnoses.length}>
      {diagnoses.map((diagnosis) => (
        <ListRow
          key={diagnosis.id}
          selected={diagnosis.id === selectedId}
          onSelect={() => onSelect(diagnosis.id)}
          title={diagnosis.title || diagnosis.issue.shortId}
          time={formatTime(diagnosis.detectedAt)}
          summary={diagnosisPlaceLine(diagnosis)}
          tags={
            <>
              <ReproductionTag diagnosis={diagnosis} />
              <DiagnosisStatusTag diagnosis={diagnosis} />
            </>
          }
        />
      ))}
    </ListKindGroup>
  );
}

/**
 * 펼친 창 목록의 `초안 n` 묶음. 상태는 줄의 태그로만 보인다.
 * 행에는 송신자, 시각, 요구 요약(초안이 없으면 게시물), 태그를 보인다.
 */
function BundleList({ bundles, selectedId, onSelect }: BundleListProps) {
  return (
    <>
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
    </>
  );
}
