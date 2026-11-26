import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type MouseEvent } from 'react';
import type { DiagnosisAttachmentSnapshot, DiagnosisReportSnapshot, DiagnosisSnapshot } from '../../shared/ipc';
import { StateTag } from './ReviewList';
import { tabId, tabPanelId, UnderlineTabs } from './UnderlineTabs';
import {
  attachmentSizeText,
  CONFIDENCE_TEXT,
  causeParts,
  diagnosisAttentionTag,
  DIAGNOSIS_WRAP_UP_TEXT,
  diagnosisEvidenceLocation,
  diagnosisExtensionAskText,
  EXPORT_CONFIRM_TEXT,
  diagnosisFailureText,
  diagnosisMetaLine,
  diagnosisProgressText,
  diagnosisRepoWaitText,
  diagnosisRunLine,
  diagnosisRunningText,
  diagnosisStatusTag,
  diagnosisTabs,
  DIRECTIVE_FORM_TEXT,
  issueFacts,
  omittedAttachmentsText,
  NO_ATTACHMENTS_TEXT,
  NO_EVIDENCE_TEXT,
  REDIAGNOSE_CHOICES,
  REDIAGNOSING_FOOTER_TEXT,
  rediagnosisFailureNotice,
  REPRODUCTION_NOT_ALLOWED_NOTE,
  reportEventFacts,
  reportRunFacts,
  reproductionTag,
  reproductionText,
  type DiagnosisTabId,
  type IssueFact,
  type RediagnoseChoice,
} from './diagnosis-text';
import { circledNumber, formatTime } from './review-text';

/** 진단 하나를 그리는 화면에 넘기는 값. */
interface DiagnosisProps {
  /** 그릴 진단. */
  diagnosis: DiagnosisSnapshot;
}

/**
 * 바닥 줄의 지시 입력을 어느 진단에 열었는지. 보고서 위 알림 줄의 [다시 걸기]와 바닥 줄의 [다시 진단 ▾]가 같은 입력을 열기 때문에
 * 몸통과 바닥 줄을 함께 그리는 화면이 이 상태를 들고 둘에 넘긴다. 진단 하나에만 열고, 다른 진단으로 넘어가면 닫힌 것으로 본다.
 */
export interface DirectivePane {
  /** 지시 입력을 연 진단 ID. 열지 않았으면 `null`. */
  openId: number | null;
  /** 진단의 지시 입력을 연다. */
  open: (diagnosisId: number) => void;
  /** 지시 입력을 닫는다. */
  close: () => void;
}

/** 지시 입력을 어느 진단에 열었는지 기억한다. 몸통과 바닥 줄을 함께 그리는 화면이 한 번 부르고 둘에 넘긴다. */
export function useDirectivePane(): DirectivePane {
  /** 지시 입력을 연 진단 ID. */
  const [openId, setOpenId] = useState<number | null>(null);
  return { openId, open: setOpenId, close: () => setOpenId(null) };
}

/** 진단의 상태 태그. 대기는 회색, 저장소 대기는 노랑이다. 연장을 묻는 동안에는 노란 `확인 필요`가 앞에 붙는다. */
export function DiagnosisStatusTag({ diagnosis }: DiagnosisProps) {
  /** 태그 이름과 색. */
  const tag = diagnosisStatusTag(diagnosis);
  /** 연장을 묻는 동안의 `확인 필요`. */
  const attention = diagnosisAttentionTag(diagnosis);
  return (
    <>
      {attention && <StateTag label={attention.label} tone={attention.tone} />}
      <StateTag label={tag.label} tone={tag.tone} />
    </>
  );
}

/** 목록 줄의 재현 태그. 보고서가 있을 때만 붙고, 없으면 그리지 않는다. */
export function ReproductionTag({ diagnosis }: DiagnosisProps) {
  if (!diagnosis.report) return null;
  /** 태그 이름과 색. */
  const tag = reproductionTag(diagnosis.report.reproduction);
  return <StateTag label={tag.label} tone={tag.tone} />;
}

/** 오류 제목. 제목이 없으면 짧은 ID다. */
function titleOf(diagnosis: DiagnosisSnapshot): string {
  return diagnosis.title || diagnosis.issue.shortId;
}

/** [Sentry에서 열기]. 열 주소가 없으면 그리지 않는다. */
export function OpenInSentryButton({ diagnosis }: DiagnosisProps) {
  /** 오류 이슈를 Sentry에서 연다. 주소는 main이 정한다. */
  const handleOpen = () => {
    void window.stardraft.send({ type: 'open-diagnosis-in-sentry', diagnosisId: diagnosis.id });
  };

  if (!diagnosis.canOpenInSentry) return null;
  return (
    <button type="button" className="btn link" onClick={handleOpen}>
      Sentry에서 열기
    </button>
  );
}

/** 상세 머리에 넘기는 값. */
interface DiagnosisHeadProps extends DiagnosisProps {
  /** [접어 보기]를 눌렀다. */
  onCollapse: () => void;
}

/**
 * 펼친 창 진단 상세 머리. 오류 제목, `프로젝트 · 신규/재발 · 감지 시각`과 [Sentry에서 열기], 에이전트와 걸린 시간(보고서가 있을 때),
 * 상태 태그, [접어 보기]다.
 */
export function DiagnosisHead({ diagnosis, onCollapse }: DiagnosisHeadProps) {
  /** 에이전트와 걸린 시간. 보고서가 없으면 `null`. */
  const runLine = diagnosisRunLine(diagnosis.report);
  return (
    <header className="detail-head">
      <div className="detail-title">
        <h2>{titleOf(diagnosis)}</h2>
        <div className="detail-meta">
          <p className="review-meta">
            <span>{diagnosisMetaLine(diagnosis)}</span>
          </p>
          <OpenInSentryButton diagnosis={diagnosis} />
        </div>
        {runLine && <p className="run-line">{runLine}</p>}
      </div>
      <DiagnosisStatusTag diagnosis={diagnosis} />
      <button type="button" className="btn sm" onClick={onCollapse}>
        접어 보기
      </button>
    </header>
  );
}

/**
 * 작은 창 진단 상세 머리. 첫 줄은 오류 제목, 둘째 줄은 `프로젝트 · 신규/재발 · 감지 시각`과 [Sentry에서 열기], 셋째 줄은 실행 줄이다.
 * 상태 태그는 작은 창 머리의 대기열 줄에 있다.
 */
export function DiagnosisMeta({ diagnosis }: DiagnosisProps) {
  /** 에이전트와 걸린 시간. 보고서가 없으면 `null`. */
  const runLine = diagnosisRunLine(diagnosis.report);
  return (
    <div className="bundle-meta">
      <p className="review-meta">
        <strong>{titleOf(diagnosis)}</strong>
      </p>
      <p className="post-line">
        <span>{diagnosisMetaLine(diagnosis)}</span>
        <OpenInSentryButton diagnosis={diagnosis} />
      </p>
      {runLine && <p className="run-line">{runLine}</p>}
    </div>
  );
}

/** 진단 상세 몸통이 놓이는 창. 펼친 창은 탭, 작은 창은 접는 구역으로 보고서를 보인다. */
export type DiagnosisWindowKind = 'compact' | 'expanded';

/** 상세 몸통에 넘기는 값. */
interface DiagnosisBodyProps extends DiagnosisProps {
  /** 몸통이 놓이는 창. 없으면 펼친 창이다. */
  windowKind?: DiagnosisWindowKind;
  /** 알림 줄의 [다시 걸기]가 열 지시 입력. 바닥 줄과 같은 것을 넘긴다. 없으면 [다시 걸기]를 보이지 않는다. */
  directivePane?: DirectivePane;
}

/**
 * 진단 상세의 머리 아래 부분. 보고서가 있으면 펼친 창은 `보고서` · `근거 n` · `첨부 n` · `정보` 탭을 두고 작은 창은 접는 구역으로 보인다.
 * 보고서가 없으면 탭이 없고, 대기·진행 중은 `진행`, 진단 실패는 `오류` 상자, 완료함은 `기록`을 두고 그 아래에 `오류 정보`를 둔다.
 * 저장소 대기는 이유 상자를 두지 않고 노란 바닥 줄이 이유를 알린다.
 * 다시 진단하지 못하고 앞선 보고서로 돌아왔으면 보고서 위에 노란 알림 줄이 사유와 [다시 걸기]를 보인다.
 * 진단이 바뀌면 탭과 접힘 상태를 처음으로 되돌리려고 `key`를 진단 ID로 둔다.
 */
export function DiagnosisBody({ diagnosis, windowKind = 'expanded', directivePane }: DiagnosisBodyProps) {
  /** 작은 창이면 `true`. 작은 창은 머리 정보를 몸통 맨 위에 둔다. */
  const compact = windowKind === 'compact';
  /** 몸통을 감싸는 요소의 클래스. */
  const className = compact ? 'popover-body review-body' : 'detail-body';
  if (diagnosis.report && !compact) {
    return (
      <>
        <RediagnosisNotice diagnosis={diagnosis} directivePane={directivePane} />
        <DiagnosisTabs key={diagnosis.id} diagnosis={diagnosis} report={diagnosis.report} />
      </>
    );
  }
  return (
    <main className={className}>
      {compact && <DiagnosisMeta diagnosis={diagnosis} />}
      <RediagnosisNotice diagnosis={diagnosis} directivePane={directivePane} />
      <DiagnosisSections key={diagnosis.id} diagnosis={diagnosis} />
    </main>
  );
}

/** 알림 줄에 넘기는 값. */
interface RediagnosisNoticeProps extends DiagnosisProps {
  /** [다시 걸기]가 열 지시 입력. 없으면 [다시 걸기]를 보이지 않는다. */
  directivePane?: DirectivePane | undefined;
}

/**
 * 보고서 위 알림 줄. 다시 진단하지 못하고 앞선 보고서로 돌아온 검토 대기 진단에만 있다.
 * "다시 진단하지 못했습니다: 사유 앞선 보고서를 그대로 둡니다."와 [다시 걸기]다. [다시 걸기]는 쌓인 지시와 함께 지시 입력을 연다.
 */
export function RediagnosisNotice({ diagnosis, directivePane }: RediagnosisNoticeProps) {
  if (diagnosis.status !== 'ready' || !diagnosis.rediagnosisFailure) return null;
  return (
    <div className="notice-line">
      <span>{rediagnosisFailureNotice(diagnosis.rediagnosisFailure)}</span>
      {directivePane && (
        <button type="button" className="btn sm" onClick={() => directivePane.open(diagnosis.id)}>
          다시 걸기
        </button>
      )}
    </div>
  );
}

/** 보고서가 없을 때(또는 작은 창에서) 몸통에 쌓는 구역들. */
function DiagnosisSections({ diagnosis }: DiagnosisProps) {
  if (diagnosis.report) return <DiagnosisFolds diagnosis={diagnosis} report={diagnosis.report} />;
  if (diagnosis.status === 'completed') {
    return (
      <Section title="기록">
        <FactList
          facts={[
            { label: '완료한 때', value: diagnosis.completedAt === null ? '모름' : formatTime(diagnosis.completedAt) },
            { label: '마지막으로 내보낸 파일', value: diagnosis.lastExportedPath ?? '내보낸 적 없음' },
          ]}
        />
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

/** 보고서가 있는 상세에 넘기는 값. */
interface DiagnosisReportProps extends DiagnosisProps {
  /** 그릴 보고서. */
  report: DiagnosisReportSnapshot;
}

/** 근거 번호를 눌렀을 때 근거를 강조하라고 알리는 값. 같은 번호를 거듭 눌러도 다시 강조하려고 누른 횟수를 함께 둔다. */
interface EvidenceHighlight {
  /** 강조할 근거 번호. */
  evidenceId: number;
  /** 누른 횟수. */
  count: number;
}

/** 탭 묶음의 id 앞부분. */
const TAB_ID_PREFIX = 'diagnosis';

/**
 * 펼친 창의 진단 상세. 머리 아래의 밑줄 탭과 고른 탭의 내용이다. 원인 글의 근거 번호를 누르면 `근거` 탭으로 가서 그 근거를 강조한다.
 */
function DiagnosisTabs({ diagnosis, report }: DiagnosisReportProps) {
  /** 고른 탭. */
  const [tab, setTab] = useState<DiagnosisTabId>('report');
  /** 강조할 근거. */
  const [highlight, setHighlight] = useState<EvidenceHighlight | null>(null);

  /** 원인 글의 근거 번호를 눌렀다. 근거 탭을 열고 그 근거를 강조한다. */
  const handleCite = (evidenceId: number) => {
    setTab('evidence');
    setHighlight((current) => ({ evidenceId, count: (current?.count ?? 0) + 1 }));
  };

  return (
    <>
      <UnderlineTabs
        label="진단 보고서"
        idPrefix={TAB_ID_PREFIX}
        tabs={diagnosisTabs(report, diagnosis.attachments.length)}
        selected={tab}
        onSelect={setTab}
        className="detail-tabs"
      />
      <main className="detail-body" role="tabpanel" id={tabPanelId(TAB_ID_PREFIX, tab)} aria-labelledby={tabId(TAB_ID_PREFIX, tab)}>
        <DiagnosisTabPanel diagnosis={diagnosis} report={report} tab={tab} highlight={highlight} onCite={handleCite} />
      </main>
    </>
  );
}

/** 탭 내용에 넘기는 값. */
interface DiagnosisTabPanelProps extends DiagnosisReportProps {
  /** 보일 탭. */
  tab: DiagnosisTabId;
  /** 강조할 근거. 없으면 `null`. */
  highlight?: EvidenceHighlight | null;
  /** 원인 글의 근거 번호를 눌렀다. */
  onCite?: ((evidenceId: number) => void) | undefined;
}

/**
 * 탭 하나의 내용.
 * `보고서`는 요약 → 재현(결과를 제목 옆에) → 원인(확신도를 제목 옆에) → 개선 방향 → 남은 의문,
 * `근거`는 번호·설명·`저장소 · 파일 · 줄`·[에디터에서 열기],
 * `첨부`는 첨부 목록(없으면 빈 상태), `정보`는 오류 정보와 진단 정보다.
 */
export function DiagnosisTabPanel({ diagnosis, report, tab, highlight = null, onCite }: DiagnosisTabPanelProps) {
  switch (tab) {
    case 'report':
      return (
        <>
          <SummarySection report={report} />
          <ReproductionSection report={report} />
          <CauseSection report={report} onCite={onCite} />
          <ImprovementsSection report={report} />
          <OpenQuestionsSection report={report} />
        </>
      );
    case 'evidence':
      return <EvidenceList diagnosis={diagnosis} report={report} highlight={highlight} />;
    case 'attachments':
      return <AttachmentList attachments={diagnosis.attachments} omitted={report.omittedAttachments} />;
    case 'info':
      return (
        <>
          <Section title="오류 정보">
            <FactList facts={[...issueFacts(diagnosis), ...reportEventFacts(report)]} />
          </Section>
          <Section title="진단 정보">
            <FactList facts={reportRunFacts(report)} />
          </Section>
        </>
      );
  }
}

/** 작은 창의 진단 상세. 탭 대신 접는 구역이고, 요약·재현·원인·개선 방향은 펴고 근거·남은 의문·오류 정보·진단 정보는 접어 둔다. */
function DiagnosisFolds({ diagnosis, report }: DiagnosisReportProps) {
  /** 강조할 근거. 접는 구역에서는 근거 구역을 펴며 강조한다. */
  const [highlight, setHighlight] = useState<EvidenceHighlight | null>(null);
  /** 근거 구역을 강제로 펴라는 요청. 누른 횟수가 늘 때마다 펴 준다. */
  const [evidenceOpen, setEvidenceOpen] = useState(false);

  /** 원인 글의 근거 번호를 눌렀다. 근거 구역을 펴고 그 근거를 강조한다. */
  const handleCite = (evidenceId: number) => {
    setEvidenceOpen(true);
    setHighlight((current) => ({ evidenceId, count: (current?.count ?? 0) + 1 }));
  };

  return (
    <>
      <FoldSection title="요약" initiallyOpen>
        <p>{report.summary}</p>
      </FoldSection>
      <FoldSection title="재현" detail={reproductionText(report.reproduction)} initiallyOpen>
        <ReproductionBody report={report} />
      </FoldSection>
      <FoldSection title="원인" detail={CONFIDENCE_TEXT[report.cause.confidence]} initiallyOpen>
        <CauseText report={report} onCite={handleCite} />
      </FoldSection>
      <FoldSection title="개선 방향" initiallyOpen>
        <TextList items={report.improvements} />
      </FoldSection>
      <FoldSection title={`근거 ${report.evidence.length}개`} open={evidenceOpen} onToggle={setEvidenceOpen}>
        <EvidenceList diagnosis={diagnosis} report={report} highlight={highlight} />
      </FoldSection>
      <FoldSection title="남은 의문">
        <TextList items={report.openQuestions} />
      </FoldSection>
      {(diagnosis.attachments.length > 0 || report.omittedAttachments > 0) && (
        <FoldSection title={`첨부 ${diagnosis.attachments.length}`}>
          <AttachmentList attachments={diagnosis.attachments} omitted={report.omittedAttachments} />
        </FoldSection>
      )}
      <FoldSection title="오류 정보">
        <FactList facts={[...issueFacts(diagnosis), ...reportEventFacts(report)]} />
      </FoldSection>
      <FoldSection title="진단 정보">
        <FactList facts={reportRunFacts(report)} />
      </FoldSection>
    </>
  );
}

/** 접는 구역에 넘기는 값. */
interface FoldSectionProps {
  /** 구역 이름. */
  title: string;
  /** 이름 옆에 작게 붙이는 말(재현 결과, 확신도). */
  detail?: string;
  /** 처음에 펴져 있는지 여부. 펼침을 부르는 쪽이 정하지 않을 때만 쓴다. */
  initiallyOpen?: boolean;
  /** 펼침을 부르는 쪽이 정한다. 주면 이 값이 펼침 상태이고 `onToggle`로 바뀐다. */
  open?: boolean;
  /** 펼침이 바뀌었다. `open`을 줄 때 함께 준다. */
  onToggle?: (open: boolean) => void;
  /** 펼쳤을 때 보일 내용. */
  children: React.ReactNode;
}

/** 작은 창 진단 상세의 접는 구역. 펼침은 이 창 안에서만 기억하고 앱 설정에는 남기지 않는다. */
function FoldSection({ title, detail, initiallyOpen = false, open, onToggle, children }: FoldSectionProps) {
  /** 스스로 기억하는 펼침. */
  const [ownOpen, setOwnOpen] = useState(initiallyOpen);
  /** 지금 펼쳐져 있는지 여부. */
  const isOpen = open ?? ownOpen;
  /** 구역을 접거나 편다. */
  const handleToggle = () => {
    if (onToggle) onToggle(!isOpen);
    else setOwnOpen(!isOpen);
  };

  return (
    <section className="review-section">
      <div className="section-head">
        <button type="button" className="section-toggle" aria-expanded={isOpen} onClick={handleToggle}>
          <span className="section-chevron" aria-hidden="true">
            {isOpen ? '▾' : '▸'}
          </span>
          <span>{title}</span>
          {detail && <span className="section-detail">{detail}</span>}
        </button>
      </div>
      {isOpen && <div className="section-body">{children}</div>}
    </section>
  );
}

/** 보고서 구역에 넘기는 값. */
interface ReportSectionProps {
  /** 그릴 보고서. */
  report: DiagnosisReportSnapshot;
}

/** `요약` 구역. */
function SummarySection({ report }: ReportSectionProps) {
  return (
    <Section title="요약">
      <p>{report.summary}</p>
    </Section>
  );
}

/** `재현` 구역. 결과를 제목 옆에 보인다. */
function ReproductionSection({ report }: ReportSectionProps) {
  return (
    <Section title="재현" aside={reproductionText(report.reproduction)}>
      <ReproductionBody report={report} />
    </Section>
  );
}

/**
 * 재현 칸의 내용. 재현 불가(허용 안 됨)면 안내와 [저장소 설정 열기]를 보이고, 아니면 방법과 순서를 보인다.
 * 재현이 성공이 아니면 순서는 시도한 것이라 그렇게 이름 붙인다.
 */
function ReproductionBody({ report }: ReportSectionProps) {
  /** 설정 "저장소" 칸을 연다. 재현 허용은 거기 있다. */
  const handleOpenRepositories = () => {
    void window.stardraft.send({ type: 'open-settings', section: 'repositories' });
  };

  if (report.reproduction.impossibleReason === 'not-allowed') {
    return (
      <>
        <p className="small muted">{REPRODUCTION_NOT_ALLOWED_NOTE}</p>
        <p>
          <button type="button" className="btn sm" onClick={handleOpenRepositories}>
            저장소 설정 열기
          </button>
        </p>
      </>
    );
  }
  return (
    <>
      {report.reproduction.method && <p>{report.reproduction.method}</p>}
      {report.reproduction.result !== 'success' && report.reproduction.steps.length > 0 && <p className="small muted">시도한 것</p>}
      <TextList items={report.reproduction.steps} ordered />
      {report.omittedAttachments > 0 && <p className="small muted">{omittedAttachmentsText(report.omittedAttachments)}</p>}
    </>
  );
}

/** 원인 글에 넘기는 값. */
interface CauseTextProps extends ReportSectionProps {
  /** 근거 번호를 눌렀다. 없으면 번호는 누를 수 없는 글자다. */
  onCite?: ((evidenceId: number) => void) | undefined;
}

/**
 * 원인 글. 글 안의 `[근거 n]`은 Flow 초안처럼 원문자(①②)로 보이고, 그 번호의 근거가 있으면 눌러서 근거를 볼 수 있다.
 * 보고서에 없는 번호는 누를 수 없는 글자로 둔다.
 */
function CauseText({ report, onCite }: CauseTextProps) {
  return (
    <p className="cause-text">
      {causeParts(report.cause.text).map((part, index) => {
        if ('text' in part) return <span key={index}>{part.text}</span>;
        /** 이 번호의 근거가 있는지 여부. */
        const exists = report.evidence.some((evidence) => evidence.id === part.cite);
        return exists && onCite ? (
          <button key={index} type="button" className="cite" aria-label={`근거 ${circledNumber(part.cite)} 보기`} onClick={() => onCite(part.cite)}>
            {circledNumber(part.cite)}
          </button>
        ) : (
          <span key={index} className="cite none" title="이 번호의 근거가 없습니다">
            {circledNumber(part.cite)}
          </span>
        );
      })}
    </p>
  );
}

/** `원인` 구역. 확신도를 제목 옆에 보인다. */
function CauseSection({ report, onCite }: CauseTextProps) {
  return (
    <Section title="원인" aside={CONFIDENCE_TEXT[report.cause.confidence]}>
      <CauseText report={report} onCite={onCite} />
    </Section>
  );
}

/** `개선 방향` 구역. */
function ImprovementsSection({ report }: ReportSectionProps) {
  return (
    <Section title="개선 방향">
      <TextList items={report.improvements} />
    </Section>
  );
}

/** `남은 의문` 구역. */
function OpenQuestionsSection({ report }: ReportSectionProps) {
  return (
    <Section title="남은 의문">
      <TextList items={report.openQuestions} />
    </Section>
  );
}

/** 근거 목록에 넘기는 값. */
interface EvidenceListProps extends DiagnosisReportProps {
  /** 강조할 근거. 없으면 `null`. */
  highlight: EvidenceHighlight | null;
}

/**
 * 근거 목록. 원인 글의 근거 번호를 누를 때마다 강조한 근거가 보이는 자리로 스크롤한다.
 * 근거를 그리는 일은 `EvidenceItems`가 한다.
 */
function EvidenceList({ diagnosis, report, highlight }: EvidenceListProps) {
  /** 강조할 근거의 위치. */
  const highlightedIndex = highlight ? report.evidence.findIndex((evidence) => evidence.id === highlight.evidenceId) : -1;
  /** 강조한 근거 요소. 눌렀을 때 보이는 곳으로 가져온다. */
  const highlightedRef = useRef<HTMLLIElement | null>(null);
  // 근거 번호를 누를 때마다 그 근거가 보이는 자리로 스크롤한다.
  useEffect(
    function scrollToHighlighted() {
      highlightedRef.current?.scrollIntoView?.({ block: 'nearest' });
    },
    [highlight?.count],
  );

  return <EvidenceItems diagnosis={diagnosis} report={report} highlightedIndex={highlightedIndex} highlightedRef={highlightedRef} />;
}

/** 근거를 그리는 부분에 넘기는 값. */
interface EvidenceItemsProps extends DiagnosisReportProps {
  /** 강조할 근거의 위치. 없으면 -1. */
  highlightedIndex: number;
  /** 강조한 근거 요소를 담을 참조. */
  highlightedRef: React.Ref<HTMLLIElement>;
}

/**
 * 근거 목록의 내용. Flow 초안의 근거 목록과 같은 모양이다. 번호와 설명, `저장소 · 파일 · 줄`, [에디터에서 열기]를 보인다.
 * 위치를 확인하지 못한 근거는 "위치를 찾을 수 없음"을 보이고 열 수 없다.
 * 에이전트가 같은 번호를 거듭 낼 수 있으므로 번호와 근거는 위치로 구분한다.
 */
export function EvidenceItems({ diagnosis, report, highlightedIndex, highlightedRef }: EvidenceItemsProps) {
  if (report.evidence.length === 0) return <p className="small muted">{NO_EVIDENCE_TEXT}</p>;
  return (
    <ol className="evidence-list">
      {report.evidence.map((evidence, evidenceIndex) => {
        /** 이 근거가 강조됐는지 여부. */
        const highlighted = evidenceIndex === highlightedIndex;
        /** 근거의 파일과 줄을 에디터에서 연다. */
        const handleOpen = () => {
          void window.stardraft.send({ type: 'open-diagnosis-evidence-in-editor', diagnosisId: diagnosis.id, evidenceIndex });
        };
        return (
          <li key={evidenceIndex} ref={highlighted ? highlightedRef : undefined} className={highlighted ? 'evidence-item highlighted' : 'evidence-item'}>
            <p>
              <span className="evidence-number">{circledNumber(evidence.id)}</span> {evidence.explanation}
            </p>
            <div className="evidence-foot">
              <p className={evidence.located ? 'evidence-location' : 'evidence-location not-found'} title={evidence.path}>
                {evidence.located ? diagnosisEvidenceLocation(evidence) : '위치를 찾을 수 없음'}
              </p>
              <button type="button" className="btn link sm" disabled={!evidence.located} onClick={handleOpen}>
                에디터에서 열기
              </button>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** 첨부 목록에 넘기는 값. */
interface AttachmentListProps {
  /** 보고서의 첨부. */
  attachments: readonly DiagnosisAttachmentSnapshot[];
  /** 종류나 한도를 넘어 옮기지 않은 첨부 수. */
  omitted: number;
}

/** 첨부 목록. 첨부가 없으면 빈 상태 글을, 옮기지 않은 첨부가 있으면 "첨부 n개 생략"을 보인다. */
function AttachmentList({ attachments, omitted }: AttachmentListProps) {
  /** 생략 안내. */
  const omittedNote = omitted > 0 && <p className="small muted">{omittedAttachmentsText(omitted)}</p>;
  if (attachments.length === 0) {
    return (
      <>
        <p className="small muted">{NO_ATTACHMENTS_TEXT}</p>
        {omittedNote}
      </>
    );
  }
  return (
    <>
      <ul className="diagnosis-list attachment-list">
        {attachments.map((attachment) => (
          <li key={attachment.name}>
            {attachment.name} <span className="small muted">{attachmentSizeText(attachment.sizeBytes)}</span>
          </li>
        ))}
      </ul>
      {omittedNote}
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

/** 이름과 값 표에 넘기는 값. */
interface FactListProps {
  /** 표의 줄. */
  facts: readonly IssueFact[];
}

/** 이름과 값 표. */
function FactList({ facts }: FactListProps) {
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

/** 글 목록에 넘기는 값. */
interface TextListProps {
  /** 목록 항목. */
  items: readonly string[];
  /** 번호 목록인지 여부. 재현 순서처럼 차례가 있는 목록이다. */
  ordered?: boolean;
}

/** 글 목록. 비어 있으면 "없습니다."를 보인다. */
function TextList({ items, ordered = false }: TextListProps) {
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

/** 바닥 줄에 넘기는 값. */
interface DiagnosisFooterProps extends DiagnosisProps {
  /** 바닥 줄이 놓이는 창. 없으면 펼친 창이다. 노란 바닥 줄만 작은 창에서 글을 윗줄에, 버튼을 아랫줄에 둔다. */
  windowKind?: DiagnosisWindowKind;
  /** 지시 입력을 열고 닫는 상태. 알림 줄의 [다시 걸기]와 같은 것을 넘긴다. 없으면 이 바닥 줄이 스스로 기억한다. */
  directivePane?: DirectivePane;
}

/**
 * 진단의 바닥 줄. 끝내는 버튼은 왼쪽, 나아가는 버튼은 오른쪽이다.
 * 저장소 대기는 노란 바닥 줄에 진단용 글과 주 버튼 하나를 두고 치우는 버튼은 두지 않는다. 주 버튼은 그 프로젝트 매핑 편집으로 보낸다.
 * 검토 대기는 왼쪽 [완료], 오른쪽 [다시 진단 ▾]와 주 버튼 [내보내기]이고, 지시를 덧붙여 다시 진단을 고르면 바닥 줄이 지시 입력으로 펼쳐진다.
 * 다시 진단하는 중은 안내와 [취소]다(내보내기와 완료는 먼저 취소해야 한다).
 * 대기와 진행 중은 안내와 [취소], 진단 실패는 [완료]와 [다시 시도], 완료함은 안내만 둔다.
 */
export function DiagnosisFooter({ diagnosis, windowKind = 'expanded', directivePane }: DiagnosisFooterProps) {
  /** 이 진단에 취소·다시 시도·완료·연장 답 명령을 보낸다. */
  const send = (
    type: 'cancel-diagnosis' | 'retry-diagnosis' | 'retry-diagnosis-without-reproduction' | 'complete-diagnosis' | 'continue-diagnosis' | 'stop-diagnosis',
  ) => {
    void window.stardraft.send({ type, diagnosisId: diagnosis.id });
  };
  /** 진행 중인 재현하는 진단의 시간 연장 상태. 연장을 묻거나 마무리를 기다리는 중이 아니면 없다. */
  const extension = diagnosis.progress?.status === 'running' ? diagnosis.progress.extension : undefined;

  if (extension?.phase === 'asking') {
    /** 바닥 줄 글. */
    const ask = diagnosisExtensionAskText(extension.canSteer);
    return (
      <footer className={windowKind === 'compact' ? 'review-foot warn compact' : 'review-foot warn expanded'}>
        <p className="repo-wait-text">
          <strong>{ask.lead}</strong> {ask.body}
        </p>
        <div className="repo-wait-actions">
          <button type="button" className="btn" onClick={() => send('stop-diagnosis')}>
            멈추기
          </button>
          <button type="button" className="btn primary" onClick={() => send('continue-diagnosis')}>
            계속 진행
          </button>
        </div>
      </footer>
    );
  }
  if (extension?.phase === 'wrapping-up') {
    return (
      <footer className="review-foot">
        <span className="small muted">{DIAGNOSIS_WRAP_UP_TEXT}</span>
        <span className="spacer" />
        <button type="button" className="btn" onClick={() => send('cancel-diagnosis')}>
          취소
        </button>
      </footer>
    );
  }

  if (diagnosis.repoWait) {
    /** 바닥 줄 글. */
    const text = diagnosisRepoWaitText(diagnosis.repoWait);
    /** 그 프로젝트의 매핑 편집으로 간다. */
    const handleOpenMapping = () => {
      void window.stardraft.send({ type: 'open-sentry-repo-mapping', diagnosisId: diagnosis.id });
    };
    return (
      <footer className={windowKind === 'compact' ? 'review-foot warn compact' : 'review-foot warn expanded'}>
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
    case 'ready':
      return <ReadyFooter diagnosis={diagnosis} send={send} directivePane={directivePane} />;
    case 'queued':
    case 'running':
      return (
        <footer className="review-foot">
          {diagnosis.rediagnosing ? (
            <span className="small muted">{REDIAGNOSING_FOOTER_TEXT}</span>
          ) : diagnosis.progress?.status === 'running' ? (
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
          {diagnosis.canRetryWithoutReproduction && (
            <button type="button" className="btn" onClick={() => send('retry-diagnosis-without-reproduction')}>
              재현 없이 다시 시도
            </button>
          )}
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
    case 'repo-check-needed':
      return null;
  }
}

/** 검토 대기 바닥 줄에 넘기는 값. */
interface ReadyFooterProps extends DiagnosisProps {
  /** 이 진단에 완료 명령을 보낸다. */
  send: (type: 'complete-diagnosis') => void;
  /** 지시 입력을 열고 닫는 상태. 없으면 이 바닥 줄이 스스로 기억한다. */
  directivePane: DirectivePane | undefined;
}

/**
 * 검토 대기의 바닥 줄. 지금 보이는 보고서를 내보낸 적이 없을 때 [완료]를 누르면 "내보내지 않았습니다" 확인을 띄우고,
 * 내보낸 적이 있으면 바로 완료한다. 확인을 띄운 진단 ID만 기억해, 다른 진단으로 넘어가면 확인이 저절로 닫힌다.
 * [다시 진단 ▾]에서 "다시 진단"은 바로 다시 진단하고, "지시를 덧붙여 다시 진단"은 바닥 줄을 지시 입력으로 펼친다.
 */
function ReadyFooter({ diagnosis, send, directivePane: given }: ReadyFooterProps) {
  /** 지시 입력을 스스로 기억하는 상태. 부르는 쪽이 넘기지 않았을 때 쓴다. */
  const ownPane = useDirectivePane();
  /** 쓸 지시 입력 상태. */
  const directivePane = given ?? ownPane;
  /** 확인을 띄운 진단 ID. */
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  /** 이 진단의 보고서를 내보낸다. 확인 중이었다면 확인을 닫는다. */
  const handleExport = () => {
    setConfirmingId(null);
    void window.stardraft.send({ type: 'export-diagnosis', diagnosisId: diagnosis.id });
  };
  /** [다시 진단 ▾]에서 고른 경로를 한다. 확인 중이었다면 확인을 닫는다. */
  const handleRediagnose = (choice: RediagnoseChoice) => {
    setConfirmingId(null);
    if (choice === 'directive') directivePane.open(diagnosis.id);
    else void window.stardraft.send({ type: 'rediagnose', diagnosisId: diagnosis.id });
  };

  if (directivePane.openId === diagnosis.id) {
    return (
      <footer className="review-foot stacked">
        <RediagnosisForm
          diagnosisId={diagnosis.id}
          directives={diagnosis.directives}
          reproductionAllowed={diagnosis.reproductionAllowed}
          previousReproductionSucceeded={diagnosis.report?.reproduction.result === 'success'}
          onClose={directivePane.close}
        />
      </footer>
    );
  }
  return (
    <ReadyFooterView
      confirming={confirmingId === diagnosis.id && !diagnosis.exported}
      onComplete={() => (diagnosis.exported ? send('complete-diagnosis') : setConfirmingId(diagnosis.id))}
      onConfirmComplete={() => send('complete-diagnosis')}
      onCancelConfirm={() => setConfirmingId(null)}
      onExport={handleExport}
      onRediagnose={handleRediagnose}
    />
  );
}

/** 지시 입력에 넘기는 값. */
interface RediagnosisFormProps {
  /** 다시 진단할 진단 ID. */
  diagnosisId: number;
  /** 앞서 덧붙인 지시. 덧붙인 순서다. */
  directives: readonly string[];
  /** 저장소가 재현을 허용하는지 여부. 거짓이면 "재현도 다시 하기" 체크가 없다. */
  reproductionAllowed: boolean;
  /** 앞선 보고서의 재현이 성공이었는지 여부. 참이면 "재현도 다시 하기"가 꺼진 채로 열린다. */
  previousReproductionSucceeded: boolean;
  /** 입력을 닫는다. 보내거나 [취소]를 누르면 부른다. */
  onClose: () => void;
}

/**
 * 지시를 덧붙여 다시 진단하는 입력. 바닥 줄 자리에 펼쳐진다. 위에서 아래로 이름 "지시", 앞서 덧붙인 지시(있을 때), 입력 칸,
 * 재현을 허용한 저장소면 입력 칸 아래 "재현도 다시 하기" 체크, "새 보고서가 나오면 지금 보고서를 바꿉니다" 안내, [취소] · [다시 진단]이다.
 * 체크는 앞선 재현이 성공이면 꺼진 채, 실패·불가면 켜진 채 열린다. 빈 지시로는 보낼 수 없다.
 */
export function RediagnosisForm({ diagnosisId, directives, reproductionAllowed, previousReproductionSucceeded, onClose }: RediagnosisFormProps) {
  /** 쓰고 있는 지시. */
  const [text, setText] = useState('');
  /** "재현도 다시 하기". */
  const [reproduce, setReproduce] = useState(!previousReproductionSucceeded);
  /** 지시를 덧붙여 다시 진단한다. 재현을 허용하지 않은 저장소에서는 재현 선택이 쓰이지 않는다. */
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (text.trim() === '') return;
    void window.stardraft.send({ type: 'rediagnose-with-directive', diagnosisId, directive: text, reproduce: reproductionAllowed && reproduce });
    onClose();
  };
  /** 지시 글이 바뀌었다. */
  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => setText(event.target.value);
  /** "재현도 다시 하기"를 켜거나 껐다. */
  const handleReproduceChange = (event: ChangeEvent<HTMLInputElement>) => setReproduce(event.target.checked);

  return (
    <form className="regen-form" onSubmit={handleSubmit}>
      <label className="field-label" htmlFor={`rediagnosis-directive-${diagnosisId}`}>
        {DIRECTIVE_FORM_TEXT.label}
      </label>
      {directives.length > 0 && (
        <>
          <p className="small muted">{DIRECTIVE_FORM_TEXT.previous}</p>
          <ol className="directive-list small">
            {directives.map((directive, index) => (
              <li key={index}>{directive}</li>
            ))}
          </ol>
        </>
      )}
      <textarea
        id={`rediagnosis-directive-${diagnosisId}`}
        className="text-input regen-input"
        value={text}
        placeholder={DIRECTIVE_FORM_TEXT.placeholder}
        autoFocus
        onChange={handleChange}
      />
      {reproductionAllowed && (
        <div>
          <label className="choice-row">
            <input type="checkbox" checked={reproduce} onChange={handleReproduceChange} />
            {DIRECTIVE_FORM_TEXT.reproduce}
          </label>
          <p className="field-help muted">{DIRECTIVE_FORM_TEXT.reproduceHelp}</p>
        </div>
      )}
      <p className="small muted">{DIRECTIVE_FORM_TEXT.replaceNote}</p>
      <div className="regen-actions">
        <button type="button" className="btn" onClick={onClose}>
          취소
        </button>
        <span className="spacer" />
        <button type="submit" className="btn primary" disabled={text.trim() === ''}>
          다시 진단
        </button>
      </div>
    </form>
  );
}

/** [다시 진단 ▾]에 넘기는 값. */
interface RediagnoseMenuProps {
  /** 메뉴 항목을 골랐다. */
  onPick: (choice: RediagnoseChoice) => void;
}

/** 검토 대기 보고서의 [다시 진단 ▾] 메뉴. 바닥 줄 위로 펼치고, 항목을 고르면 닫는다. */
function RediagnoseMenu({ onPick }: RediagnoseMenuProps) {
  /** 항목을 눌렀다. 메뉴를 닫고 고른 경로를 알린다. */
  const handlePick = (event: MouseEvent<HTMLButtonElement>, choice: RediagnoseChoice) => {
    event.currentTarget.closest('details')?.removeAttribute('open');
    onPick(choice);
  };

  return (
    <details className="menu">
      <summary className="btn">다시 진단 ▾</summary>
      <div className="menu-list" role="menu">
        {REDIAGNOSE_CHOICES.map(({ choice, label }) => (
          <button
            key={choice}
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={(event) => handlePick(event, choice)}
          >
            {label}
          </button>
        ))}
      </div>
    </details>
  );
}

/** 검토 대기 바닥 줄의 모양에 넘기는 값. */
export interface ReadyFooterViewProps {
  /** "내보내지 않았습니다" 확인을 보이는지 여부. */
  confirming: boolean;
  /** 평소 줄의 [완료]를 눌렀다. 내보냈으면 완료하고 아니면 확인을 띄운다. */
  onComplete: () => void;
  /** 확인의 [완료]를 눌렀다. 내보내지 않은 채 완료한다. */
  onConfirmComplete: () => void;
  /** 확인의 [취소]를 눌렀다. */
  onCancelConfirm: () => void;
  /** [내보내기]를 눌렀다. 평소 줄과 확인 줄 모두에 있다. */
  onExport: () => void;
  /** [다시 진단 ▾]에서 항목을 골랐다. 평소 줄에만 있다. 없으면 [다시 진단 ▾]를 보이지 않는다. */
  onRediagnose?: (choice: RediagnoseChoice) => void;
}

/**
 * 검토 대기 바닥 줄의 모양. 평소에는 왼쪽 [완료], 오른쪽 [다시 진단 ▾]와 주 버튼 [내보내기]다.
 * 확인 줄은 왼쪽에 안내 글, 오른쪽에 [취소] · [내보내기] · 주 버튼 [완료]다.
 */
export function ReadyFooterView({ confirming, onComplete, onConfirmComplete, onCancelConfirm, onExport, onRediagnose }: ReadyFooterViewProps) {
  if (confirming) {
    return (
      <footer className="review-foot">
        <span className="small">{EXPORT_CONFIRM_TEXT}</span>
        <span className="spacer" />
        <button type="button" className="btn" onClick={onCancelConfirm}>
          취소
        </button>
        <button type="button" className="btn" onClick={onExport}>
          내보내기
        </button>
        <button type="button" className="btn primary" onClick={onConfirmComplete}>
          완료
        </button>
      </footer>
    );
  }
  return (
    <footer className="review-foot">
      <button type="button" className="btn" onClick={onComplete}>
        완료
      </button>
      <span className="spacer" />
      {onRediagnose && <RediagnoseMenu onPick={onRediagnose} />}
      <button type="button" className="btn primary" onClick={onExport}>
        내보내기
      </button>
    </footer>
  );
}

/** 30초마다 지금 시각을 다시 읽는 간격(밀리초). 바닥 줄의 "n분 지남"은 분 단위라 이 정도면 충분하다. */
const NOW_TICK_MS = 30_000;

/** 진행 중 바닥 줄 글에 넘기는 값. */
interface RunningTextProps {
  /** 진행을 시작한 시각(Unix epoch 밀리초). */
  startedAt: number;
}

/** 진행 중 바닥 줄 글. "진단하는 중입니다 · n분 지남"이고 30초마다 다시 그린다. */
function RunningText({ startedAt }: RunningTextProps) {
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
