import { useEffect, useState } from 'react';
import type { DiagnosisReportSnapshot, DiagnosisSnapshot } from '../../shared/ipc';
import { StateTag } from './ReviewList';
import {
  CONFIDENCE_TEXT,
  diagnosisEvidenceLocation,
  diagnosisFailureText,
  diagnosisMetaLine,
  diagnosisProgressText,
  diagnosisRepoWaitText,
  diagnosisRunningText,
  diagnosisStatusTag,
  issueFacts,
  REPRODUCTION_NOT_ALLOWED_NOTE,
  reportEventFacts,
  reportRunFacts,
  reproductionText,
  type IssueFact,
} from './diagnosis-text';
import { circledNumber, formatTime } from './review-text';

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
 * 진단의 몸통. 보고서가 있으면 보고서를 순서대로(요약 → 재현 → 원인과 확신도 → 개선 방향 → 근거 → 남은 의문 → 오류 이슈 정보 → 실행 정보) 한 화면에 보인다.
 * 보고서가 없으면 대기·진행 중은 `진행`, 진단 실패는 `오류` 상자, 완료함은 `기록`을 두고, 그 아래에 `오류 정보`를 둔다.
 * 저장소 대기는 이유 상자를 두지 않고 노란 바닥 줄이 이유를 알린다.
 */
export function DiagnosisBody({ diagnosis }: DiagnosisProps) {
  if (diagnosis.report) return <DiagnosisReport diagnosis={diagnosis} report={diagnosis.report} />;
  if (diagnosis.status === 'completed') {
    return (
      <Section title="기록">
        <FactList facts={[{ label: '완료한 때', value: diagnosis.completedAt === null ? '모름' : formatTime(diagnosis.completedAt) }]} />
      </Section>
    );
  }
  return (
    <>
      {diagnosis.progress && (
        <Section title="진행">
          <div className="progress-line" role="status">
            <span>{diagnosisProgressText(diagnosis.progress)}</span>
            {diagnosis.progress.status === 'running' && <span className="small muted">읽은 파일 {diagnosis.progress.filesRead}개</span>}
          </div>
        </Section>
      )}
      {diagnosis.failure && (
        <Section title="오류">
          <div className="failure-box">
            <strong>{diagnosisFailureText(diagnosis.failure)}</strong>
            {diagnosis.failure.detail && <p className="failure-detail">{diagnosis.failure.detail}</p>}
            {diagnosis.failure.lastStep && <p className="failure-detail">마지막 단계: {diagnosis.failure.lastStep}</p>}
          </div>
        </Section>
      )}
      <Section title="오류 정보">
        <FactList facts={issueFacts(diagnosis)} />
      </Section>
    </>
  );
}

/** 보고서를 그리는 화면에 넘기는 값. */
interface DiagnosisReportProps extends DiagnosisProps {
  /** 그릴 보고서. */
  report: DiagnosisReportSnapshot;
}

/** 진단 보고서. 이 단계의 최소 모양이라 탭 없이 스펙의 순서대로 구역을 잇는다. */
function DiagnosisReport({ diagnosis, report }: DiagnosisReportProps) {
  return (
    <>
      <Section title="요약">
        <p>{report.summary}</p>
      </Section>
      <Section title="재현" aside={reproductionText(report.reproduction)}>
        {report.reproduction.impossibleReason === 'not-allowed' ? (
          <p className="small muted">{REPRODUCTION_NOT_ALLOWED_NOTE}</p>
        ) : (
          <>
            {report.reproduction.method && <p>{report.reproduction.method}</p>}
            <TextList items={report.reproduction.steps} ordered />
          </>
        )}
      </Section>
      <Section title="원인" aside={CONFIDENCE_TEXT[report.cause.confidence]}>
        <p>{report.cause.text}</p>
      </Section>
      <Section title="개선 방향">
        <TextList items={report.improvements} />
      </Section>
      <Section title={`근거 ${report.evidence.length}개`}>
        {report.evidence.length === 0 ? (
          <p className="small muted">근거가 없습니다.</p>
        ) : (
          <ol className="evidence-list">
            {report.evidence.map((evidence) => (
              <li key={evidence.id} className="evidence-item">
                <p>
                  <span className="evidence-number">{circledNumber(evidence.id)}</span> {evidence.explanation}
                </p>
                <p className={evidence.located ? 'evidence-location' : 'evidence-location not-found'} title={evidence.path}>
                  {evidence.located ? diagnosisEvidenceLocation(evidence) : '위치를 찾을 수 없음'}
                </p>
              </li>
            ))}
          </ol>
        )}
      </Section>
      <Section title="남은 의문">
        <TextList items={report.openQuestions} />
      </Section>
      <Section title="오류 이슈 정보">
        <FactList facts={[...issueFacts(diagnosis), ...reportEventFacts(report)]} />
      </Section>
      <Section title="실행 정보">
        <FactList facts={reportRunFacts(report)} />
      </Section>
    </>
  );
}

/** 구역에 넘기는 값. */
interface SectionProps {
  /** 구역 이름. */
  title: string;
  /** 이름 옆에 붙는 짧은 값(재현 결과, 확신도). 없으면 붙이지 않는다. */
  aside?: string;
  /** 구역 내용. */
  children: React.ReactNode;
}

/** 상세 몸통의 구역 하나. 초안 상세의 영역과 같은 이름 줄과 내용이다. */
function Section({ title, aside, children }: SectionProps) {
  return (
    <section className="review-section">
      <h3 className="section-title">
        {title}
        {aside && <span className="section-aside"> · {aside}</span>}
      </h3>
      <div className="section-body">{children}</div>
    </section>
  );
}

/** 이름과 값 표. */
function FactList({ facts }: { facts: readonly IssueFact[] }) {
  return (
    <dl className="diagnosis-facts">
      {facts.map((fact) => (
        <div key={fact.label} className="diagnosis-fact">
          <dt>{fact.label}</dt>
          <dd>{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** 글 목록. 비어 있으면 "없습니다."를 보인다. */
function TextList({ items, ordered = false }: { items: readonly string[]; ordered?: boolean }) {
  if (items.length === 0) return <p className="small muted">없습니다.</p>;
  /** 목록 요소. */
  const List = ordered ? 'ol' : 'ul';
  return (
    <List className="diagnosis-list">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </List>
  );
}

/**
 * 진단의 바닥 줄. 끝내는 버튼은 왼쪽, 나아가는 버튼은 오른쪽이다.
 * 저장소 대기는 노란 바닥 줄에 진단용 글과 주 버튼 하나를 두고 치우는 버튼은 두지 않는다. 주 버튼은 그 프로젝트 매핑 편집으로 보낸다.
 * 대기와 진행 중은 [취소], 진단 실패는 [완료]와 [다시 시도], 완료함은 안내만 둔다. 검토 대기의 버튼은 검토 화면 단계가 더한다.
 */
export function DiagnosisFooter({ diagnosis }: DiagnosisProps) {
  /** 이 진단에 명령을 보낸다. */
  const send = (type: 'cancel-diagnosis' | 'retry-diagnosis' | 'complete-diagnosis') => {
    void window.stardraft.send({ type, diagnosisId: diagnosis.id });
  };

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
  switch (diagnosis.status) {
    case 'queued':
    case 'running':
      return (
        <footer className="review-foot">
          {diagnosis.progress?.status === 'running' ? (
            <RunningText startedAt={diagnosis.progress.startedAt} />
          ) : (
            <span className="small muted">차례를 기다리는 중입니다.</span>
          )}
          <span className="spacer" />
          <button type="button" className="btn" onClick={() => send('cancel-diagnosis')}>
            취소
          </button>
        </footer>
      );
    case 'failed':
      return (
        <footer className="review-foot">
          <button type="button" className="btn" onClick={() => send('complete-diagnosis')}>
            완료
          </button>
          <span className="spacer" />
          <button type="button" className="btn primary" onClick={() => send('retry-diagnosis')}>
            다시 시도
          </button>
        </footer>
      );
    case 'completed':
      return (
        <footer className="review-foot">
          <span className="small muted">완료한 진단입니다. 보고서는 지웠습니다.</span>
        </footer>
      );
    case 'ready':
    case 'repo-check-needed':
      return null;
  }
}

/** 30초마다 지금 시각을 다시 읽는 간격(밀리초). 바닥 줄의 "n분 지남"은 분 단위라 이 정도면 충분하다. */
const NOW_TICK_MS = 30_000;

/** 진행 중 바닥 줄 글. "진단하는 중입니다 · n분 지남"이고 30초마다 다시 그린다. */
function RunningText({ startedAt }: { startedAt: number }) {
  /** 지금 시각. */
  const [now, setNow] = useState(() => Date.now());
  // 진행 중 바닥 줄이 보이는 동안만 시계를 돌려 지난 분을 새로 그리고, 진행이 끝나거나 화면을 떠나면 멈춘다.
  useEffect(function tickWhileShown() {
    /** 다시 읽기 예약. */
    const timer = window.setInterval(() => setNow(Date.now()), NOW_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);
  return <span className="small muted">{diagnosisRunningText(startedAt, now)}</span>;
}
