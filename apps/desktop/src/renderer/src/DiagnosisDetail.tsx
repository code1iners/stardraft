import type { DiagnosisSnapshot } from '../../shared/ipc';
import { StateTag } from './ReviewList';
import { diagnosisMetaLine, diagnosisRepoWaitText, diagnosisStatusTag, issueFacts } from './diagnosis-text';

/** 진단 하나를 그리는 화면에 넘기는 값. */
interface DiagnosisProps {
  /** 그릴 진단. */
  diagnosis: DiagnosisSnapshot;
}

/** 진단의 상태 태그. 대기는 회색, 저장소 대기는 노랑이다. */
export function DiagnosisStatusTag({ diagnosis }: DiagnosisProps) {
  /** 태그 이름과 색. */
  const tag = diagnosisStatusTag(diagnosis);
  return <StateTag label={tag.label} tone={tag.tone} />;
}

/** 상세 머리에 넘기는 값. */
interface DiagnosisHeadProps extends DiagnosisProps {
  /** [접어 보기]를 눌렀다. */
  onCollapse: () => void;
}

/** 진단 상세 머리. 오류 제목, `프로젝트 · 신규/재발 · 감지 시각`, 상태 태그, [접어 보기]다. */
export function DiagnosisHead({ diagnosis, onCollapse }: DiagnosisHeadProps) {
  return (
    <header className="detail-head">
      <div className="detail-title">
        <h2>{diagnosis.title || diagnosis.issue.shortId}</h2>
        <div className="detail-meta">
          <p className="review-meta">
            <span>{diagnosisMetaLine(diagnosis)}</span>
          </p>
        </div>
      </div>
      <DiagnosisStatusTag diagnosis={diagnosis} />
      <button type="button" className="btn sm" onClick={onCollapse}>
        접어 보기
      </button>
    </header>
  );
}

/**
 * 보고서가 없는 진단의 몸통. 이 단계의 진단(대기, 저장소 대기)은 `오류 정보`만 보인다.
 * 저장소 대기는 이유 상자를 두지 않고 노란 바닥 줄이 이유를 알린다.
 */
export function DiagnosisBody({ diagnosis }: DiagnosisProps) {
  return (
    <section className="review-section">
      <h3 className="section-title">오류 정보</h3>
      <div className="section-body">
        <dl className="diagnosis-facts">
          {issueFacts(diagnosis).map((fact) => (
            <div key={fact.label} className="diagnosis-fact">
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

/**
 * 진단의 바닥 줄. 저장소 대기는 노란 바닥 줄에 진단용 글과 주 버튼 하나를 두고 치우는 버튼은 두지 않는다.
 * 주 버튼은 설정 "저장소" 칸 `Sentry` 탭의 그 프로젝트 매핑 편집으로 보낸다. 대기는 기다린다는 글만 둔다.
 */
export function DiagnosisFooter({ diagnosis }: DiagnosisProps) {
  if (diagnosis.repoWait) {
    /** 바닥 줄 글. */
    const text = diagnosisRepoWaitText(diagnosis.repoWait);
    /** 그 프로젝트의 매핑 편집으로 간다. */
    const handleOpenMapping = () => {
      void window.stardraft.send({ type: 'open-sentry-repo-mapping', diagnosisId: diagnosis.id });
    };
    return (
      <footer className="review-foot warn expanded">
        <p className="repo-wait-text">
          <strong>{text.lead}</strong> {text.before}
          {text.path !== null && <code>{text.path}</code>} {text.after}
        </p>
        <div className="repo-wait-actions">
          <button type="button" className="btn primary" onClick={handleOpenMapping}>
            {diagnosis.repoWait.kind === 'unmapped' ? '저장소 매핑하기' : '매핑 고치기'}
          </button>
        </div>
      </footer>
    );
  }
  return (
    <footer className="review-foot">
      <span className="small muted">차례를 기다리는 중입니다.</span>
    </footer>
  );
}
