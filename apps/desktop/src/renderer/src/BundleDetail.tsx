import { useState, type ChangeEvent, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import type {
  AutoSelectionSnapshot,
  BundleSnapshot,
  BundleStatusSnapshot,
  DraftSnapshot,
  FailureSnapshot,
  GenerationSnapshot,
  RepoCheckSnapshot,
  ReviewSection,
  ReviewSnapshot,
  ReviewWindow,
  TextPartSnapshot,
  ThreadEntrySnapshot,
} from '../../shared/ipc';
import {
  BUNDLE_PLACE_LABELS,
  BUNDLE_STATUS_TAGS,
  circledNumber,
  evidenceLocation,
  failureText,
  formatMentionTime,
  generationStepText,
  LINKED_NOTE,
  linkButtonText,
  MENTION_PLACE_LABELS,
  postBodyLength,
  postBodyLengthText,
  postLine,
  PROCESSED_NOTES,
  reasonText,
  repoCheckText,
  runLineText,
  senderLine,
} from './review-text';
import type { IgnoreToastState } from './useReview';

/** 자동 선택이 생기기 전에 사유 없이 저장소 확인 필요가 된 묶음의 저장소 영역 안내. */
const NO_REPOSITORY_NOTE = '아직 이 묶음에 쓸 저장소를 정하지 않았습니다.';

/** 상태 태그에 넘기는 값. */
interface StatusTagProps {
  /** 묶음 상태. */
  status: BundleStatusSnapshot;
}

/** 묶음 상태 태그. */
export function StatusTag({ status }: StatusTagProps) {
  /** 태그 이름과 색. */
  const tag = BUNDLE_STATUS_TAGS[status];
  return <span className={`tag ${tag.className}`}>{tag.label}</span>;
}

/** 묶음 하나를 그리는 화면에 넘기는 값. */
interface BundleProps {
  /** 그릴 묶음. */
  bundle: BundleSnapshot;
}

/** "Flow에서 열기". 열 주소가 없으면 보이지 않는다. 주소는 main이 정한다. */
export function OpenInFlowButton({ bundle }: BundleProps) {
  /** 묶음의 게시물을 Flow에서 연다. */
  const handleOpen = () => {
    void window.stardraft.send({ type: 'open-bundle-in-flow', bundleId: bundle.id });
  };

  if (!bundle.canOpenInFlow) return null;
  return (
    <button type="button" className="btn link" onClick={handleOpen}>
      Flow에서 열기
    </button>
  );
}

/** 상세 머리의 실행 줄. "Claude Code · 2분 14초 · 맥락 일부 생략"이다. 보일 실행이 없으면 그리지 않는다. */
export function RunLine({ bundle }: BundleProps) {
  if (!bundle.run) return null;
  return <p className="run-line">{runLineText(bundle.run)}</p>;
}

/** 작은 창 상세 머리. 첫 줄은 송신자·멘션 자리·시각, 둘째 줄은 게시물과 "Flow에서 열기", 셋째 줄은 실행 줄이다. */
export function BundleMeta({ bundle }: BundleProps) {
  return (
    <div className="bundle-meta">
      <p className="review-meta">
        <strong>{senderLine(bundle.senderNames)}</strong>
        <span>{BUNDLE_PLACE_LABELS[bundle.place]}</span>
        <span>{formatMentionTime(bundle.lastMentionAt)}</span>
      </p>
      <p className="post-line">
        <span>{postLine(bundle)}</span>
        <OpenInFlowButton bundle={bundle} />
      </p>
      <RunLine bundle={bundle} />
    </div>
  );
}

/** 접고 펴는 영역에 넘기는 값. */
interface ReviewSectionBlockProps {
  /** 영역이 있는 창. 펼침 상태는 창마다 따로 기억한다. */
  windowKind: ReviewWindow;
  /** 영역. */
  section: ReviewSection;
  /** 펼쳐져 있는지 여부. */
  open: boolean;
  /** 머리 제목. */
  title: string;
  /** 머리 제목 옆에 작게 붙이는 말. */
  detail?: string;
  /** 머리 오른쪽에 두는 버튼. 접고 펴는 버튼 밖에 있어 누르면 그 일만 한다. */
  action?: ReactNode;
  /** 펼쳤을 때 보일 내용. */
  children: ReactNode;
}

/** 머리를 눌러 접고 펴는 상세 영역. 펼침 상태는 main이 창마다 기억한다. */
function ReviewSectionBlock({ windowKind, section, open, title, detail, action, children }: ReviewSectionBlockProps) {
  /** 영역을 접거나 편다. */
  const handleToggle = () => {
    void window.stardraft.send({ type: 'set-review-section', window: windowKind, section, open: !open });
  };

  return (
    <section className="review-section">
      <div className="section-head">
        <button type="button" className="section-toggle" aria-expanded={open} onClick={handleToggle}>
          <span className="section-chevron" aria-hidden="true">
            {open ? '▾' : '▸'}
          </span>
          <span>{title}</span>
          {detail && <span className="section-detail">{detail}</span>}
        </button>
        {action}
      </div>
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}

/** 글 조각에 넘기는 값. */
interface PartsTextProps {
  /** 글 조각. */
  parts: TextPartSnapshot[];
}

/** Flow 글. 멘션 표기(`@이름`)는 강조하고, HTML이 아니라 글자로 그린다. */
function PartsText({ parts }: PartsTextProps) {
  return (
    <p className="mention-text">
      {parts.map((part, index) => (
        <span key={index} className={part.mention ? 'mention-at' : undefined}>
          {part.text}
        </span>
      ))}
    </p>
  );
}

/** 원문 영역 내용. 묶인 멘션 전부를 시간순으로 보인다. */
function MentionList({ bundle }: BundleProps) {
  return (
    <ol className="mention-list">
      {bundle.mentions.map((mention, index) => (
        <li key={index} className="mention-item">
          <div className="mention-meta">
            <strong>{mention.senderName || '이름 없음'}</strong>
            <span>{MENTION_PLACE_LABELS[mention.place]}</span>
            <span>{formatMentionTime(mention.at)}</span>
          </div>
          <PartsText parts={mention.text} />
        </li>
      ))}
    </ol>
  );
}

/** 스레드 보기에 넘기는 값. */
interface ThreadListProps {
  /** 시간순으로 보일 글. */
  entries: ThreadEntrySnapshot[];
}

/** "스레드 보기"로 펼친 글. 앞선 글과 묶음의 멘션을 시간순으로 보이고, 멘션에는 태그를 붙인다. 대댓글은 들여 쓴다. */
export function ThreadList({ entries }: ThreadListProps) {
  return (
    <ol className="mention-list">
      {entries.map((entry, index) => (
        <li key={index} className={`mention-item thread-item${entry.place === 'reply' ? ' is-reply' : ''}${entry.mention ? ' is-mention' : ''}`}>
          <div className="mention-meta">
            <strong>{entry.authorName || '이름 없음'}</strong>
            <span>{MENTION_PLACE_LABELS[entry.place]}</span>
            {entry.at !== null && <span>{formatMentionTime(entry.at)}</span>}
            {entry.mention && <span className="tag warn">멘션</span>}
          </div>
          <PartsText parts={entry.text} />
          {entry.attachments.length > 0 && <p className="small muted">첨부 있음({entry.attachments.join(', ')})</p>}
        </li>
      ))}
    </ol>
  );
}

/** 원문 영역 내용에 넘기는 값. */
interface OriginalBodyProps extends BundleProps {
  /** "스레드 보기"로 펼쳤는지 여부. */
  threadOpen: boolean;
  /** "스레드 보기"나 "멘션만 보기"를 눌렀다. */
  onToggleThread: () => void;
}

/** 원문 영역 내용. 처음에는 멘션만 보이고, 맥락을 조회한 묶음은 "스레드 보기"로 앞선 글까지 펼친다. */
function OriginalBody({ bundle, threadOpen, onToggleThread }: OriginalBodyProps) {
  /** 펼칠 앞선 글이 있는지 여부. */
  const hasThread = bundle.thread.some((entry) => !entry.mention);
  return (
    <>
      {threadOpen && hasThread ? <ThreadList entries={bundle.thread} /> : <MentionList bundle={bundle} />}
      {hasThread && (
        <button type="button" className="btn link thread-toggle" aria-expanded={threadOpen} onClick={onToggleThread}>
          {threadOpen ? '멘션만 보기' : '스레드 보기'}
        </button>
      )}
    </>
  );
}

/** 초안 영역 내용에 넘기는 값. */
interface DraftProps {
  /** 그릴 초안. */
  draft: DraftSnapshot;
}

/**
 * 초안. 문단마다 문장을 잇고, 문장마다 근거 번호(①②)를, 근거 없는 문장에는 "근거 없음"을 붙인다.
 * 에이전트가 같은 번호를 거듭 낼 수 있으므로 번호와 근거는 위치로 구분한다.
 */
function DraftBody({ draft }: DraftProps) {
  return (
    <div className="draft-text">
      {draft.paragraphs.map((paragraph, paragraphIndex) => (
        <p key={paragraphIndex}>
          {paragraph.sentences.map((sentence, sentenceIndex) => (
            <span key={sentenceIndex}>
              {sentenceIndex > 0 && ' '}
              <span className={sentence.evidence.length > 0 ? 'sentence' : 'sentence no-evidence'}>{sentence.text}</span>
              {sentence.evidence.length > 0 ? (
                sentence.evidence.map((id, citeIndex) => (
                  <span key={citeIndex} className="cite">
                    {circledNumber(id)}
                  </span>
                ))
              ) : (
                <span className="cite none" title="이 문장을 뒷받침하는 근거가 없습니다">
                  근거 없음
                </span>
              )}
            </span>
          ))}
        </p>
      ))}
    </div>
  );
}

/** 초안 편집기에 넘기는 값. */
interface DraftEditorProps extends DraftProps {
  /** 초안이 있는 묶음 ID. 편집·되돌리기·받는 사람 빼기 명령에 실어 보낸다. */
  bundleId: number;
}

/**
 * 초안 영역 내용. 머리 바로 아래에 받는 사람 줄, 그 아래 편집기, 편집기 아래에 글자 수를 둔다.
 * 고치지 않은 초안은 근거 번호가 붙은 글로 보이고, 누르거나 Enter를 치면 같은 자리에 편집기가 열린다. 고치면 근거 번호가 사라지고 "원래 초안으로 되돌리기"가 생긴다.
 * 고칠 수 없는 묶음(처리됨 등)은 글로만 보인다.
 */
function DraftEditor({ bundleId, draft }: DraftEditorProps) {
  /** 근거 번호가 붙은 글 대신 편집기를 열었는지 여부. 고치지 않고 벗어나면 다시 닫는다. */
  const [editing, setEditing] = useState(false);
  // 고칠 때마다 main에 저장하고 새 스냅숏을 받는다. 받기 전에 다음 글자를 쳐도 앞선 값으로 덮이지 않게 마지막으로 친 텍스트를 쓴다.
  /** 마지막으로 친 편집기 텍스트. 치지 않았거나 되돌렸으면 `null`. */
  const [typed, setTyped] = useState<string | null>(null);
  /** 편집기 텍스트. */
  const text = draft.canEdit && typed !== null ? typed : draft.editorText;
  /** 편집기를 보일지 여부. 근거 번호가 붙은 글은 고치기 전에만 보인다. */
  const showEditor = draft.canEdit && (editing || draft.edited);
  /** 글자 수 줄. */
  const length = postBodyLengthText(postBodyLength(draft.postBodyPrefixLength, text));

  /** 근거 번호가 붙은 글 자리에 편집기를 연다. 고치지 않고 벗어나면 다시 번호가 붙은 글이 된다. */
  const handleOpen = () => setEditing(true);
  /** Enter를 치면 편집기를 연다. */
  const handleOpenKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    setEditing(true);
  };
  /** 고친 텍스트를 편집본으로 저장한다. 원래 초안과 같아지면 main이 편집본을 지운다. */
  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setTyped(event.target.value);
    void window.stardraft.send({ type: 'edit-draft', bundleId, text: event.target.value });
  };
  /** 편집본을 버리고 근거 번호가 붙은 원래 초안으로 돌아간다. */
  const handleRevert = () => {
    setTyped(null);
    setEditing(false);
    void window.stardraft.send({ type: 'revert-draft-edit', bundleId });
  };

  return (
    <>
      <RecipientLine bundleId={bundleId} draft={draft} />
      {showEditor ? (
        <textarea
          className="text-input draft-editor"
          aria-label="초안"
          value={text}
          // 근거 번호가 붙은 글을 눌러 연 편집기는 바로 칠 수 있게 한다.
          autoFocus={!draft.edited}
          onChange={handleChange}
          onBlur={() => setEditing(false)}
        />
      ) : draft.canEdit ? (
        // 포커스만으로는 열지 않는다. 탭으로 지나가거나 근거 번호를 볼 때 번호가 사라지지 않게, 누르거나 Enter를 칠 때만 편집기를 연다.
        <div className="draft-editor annotated" role="textbox" tabIndex={0} aria-label="초안" aria-multiline="true" onClick={handleOpen} onKeyDown={handleOpenKey}>
          <DraftBody draft={draft} />
        </div>
      ) : draft.edited ? (
        <div className="draft-text plain">{text}</div>
      ) : (
        <DraftBody draft={draft} />
      )}
      {draft.canEdit && (
        <div className="draft-foot">
          {draft.edited && (
            <button type="button" className="btn link" onClick={handleRevert}>
              원래 초안으로 되돌리기
            </button>
          )}
          <span className="spacer" />
          <span className={length.over ? 'small danger-text' : 'small muted'} role={length.over ? 'alert' : undefined}>
            {length.text}
          </span>
        </div>
      )}
    </>
  );
}

/**
 * 받는 사람 줄. 테두리만 있는 작은 항목을 처음 멘션한 순서로 보이고, 고칠 수 있으면 항목마다 ×로 뺀다. 더하는 기능은 없다.
 * 모두 빼면 멘션 없이 올린다고 알린다.
 */
function RecipientLine({ bundleId, draft }: DraftEditorProps) {
  return (
    <div className="recipient-line">
      <span className="small muted">받는 사람</span>
      {draft.recipients.length === 0 && <span className="small muted">없음 · 멘션 없이 올립니다</span>}
      {draft.recipients.map((recipient, index) => {
        /** 화면에 보일 이름. */
        const name = recipient.name || '이름 없음';
        /** 이 사람을 받는 사람에서 뺀다. 사용자 ID는 main이 위치와 이름으로 찾는다. */
        const handleRemove = () => {
          void window.stardraft.send({ type: 'remove-recipient', bundleId, index, name: recipient.name });
        };
        return (
          <span key={index} className="recipient">
            @{name}
            {draft.canEdit && (
              <button type="button" className="recipient-remove" aria-label={`${name} 빼기`} onClick={handleRemove}>
                ×
              </button>
            )}
          </span>
        );
      })}
    </div>
  );
}

/**
 * 근거 영역 내용. 근거마다 자연어 설명과, 그 아래 작게 저장소·파일·줄 위치를 보인다. 전체 경로는 위치에 마우스를 올리면 보인다.
 * 위치를 찾지 못한 근거는 위치 대신 "위치를 찾을 수 없음"을 보이고, 에이전트가 적은 경로는 마우스를 올리면 보인다.
 */
function EvidenceList({ draft }: DraftProps) {
  if (draft.evidence.length === 0) return <p className="small muted">근거가 없습니다. 초안이 저장소 코드를 근거로 하지 않았습니다.</p>;
  return (
    <ol className="evidence-list">
      {draft.evidence.map((evidence, evidenceIndex) => (
        <li key={evidenceIndex} className="evidence-item">
          <p>
            <span className="evidence-number">{circledNumber(evidence.id)}</span> {evidence.explanation}
          </p>
          {evidence.located ? (
            <p className="evidence-location" title={evidence.path}>
              {evidenceLocation(evidence)}
            </p>
          ) : (
            <p className="evidence-location not-found" title={evidence.path}>
              위치를 찾을 수 없음
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}

/** 저장소 목록에 넘기는 값. */
interface RepositoryListProps {
  /** 보일 저장소. */
  repositories: DraftSnapshot['repositories'];
}

/** 저장소 목록. 저장소마다 이름과 그 아래 경로다. 초안을 만들 때 읽은 저장소와 에이전트가 짚은 후보에 쓴다. */
function RepositoryList({ repositories }: RepositoryListProps) {
  return (
    <ul className="repository-list">
      {repositories.map((repository) => (
        <li key={repository.path}>
          <strong>{repository.name}</strong>
          <span className="small muted">{repository.path}</span>
        </li>
      ))}
    </ul>
  );
}

/** 초안의 저장소 영역에 넘기는 값. */
interface DraftRepositoriesProps {
  /** 초안이 있는 묶음 ID. 연결 명령에 실어 보낸다. */
  bundleId: number;
  /** 그릴 초안. */
  draft: DraftSnapshot;
}

/**
 * 준비된 묶음의 저장소 영역 내용. 초안을 만들 때 읽은 저장소와, 자동 선택으로 정했으면 그 까닭, 연결 버튼을 보인다.
 * 연결 버튼은 이 구성으로 Flow 프로젝트의 저장소 매핑을 덮어쓴다. 이미 이 구성이 매핑이면 꺼 두고 그렇다고 알린다.
 */
function DraftRepositories({ bundleId, draft }: DraftRepositoriesProps) {
  /** 이 구성으로 저장소 매핑을 덮어쓴다. 구성은 main이 묶음에서 읽는다. */
  const handleLink = () => {
    void window.stardraft.send({ type: 'link-bundle-repos', bundleId });
  };

  return (
    <>
      <RepositoryList repositories={draft.repositories} />
      {draft.autoSelection && <AutoSelectionNote autoSelection={draft.autoSelection} />}
      <div className="repo-check-actions">
        <button type="button" className="btn" disabled={draft.mapping === 'same'} onClick={handleLink}>
          {linkButtonText(draft.mapping)}
        </button>
        {draft.mapping === 'same' && <p className="small muted">{LINKED_NOTE}</p>}
      </div>
    </>
  );
}

/** 자동 선택의 까닭에 넘기는 값. */
interface AutoSelectionNoteProps {
  /** 자동 선택의 내력. */
  autoSelection: AutoSelectionSnapshot;
}

/** 자동으로 고른 저장소의 까닭. 선택 실행이 골랐으면 그 이유를, 후보가 하나였으면 그렇게 썼다고 보인다. */
function AutoSelectionNote({ autoSelection }: AutoSelectionNoteProps) {
  if (autoSelection.kind === 'single-candidate') {
    return <p className="small muted repo-subhead">작업 폴더에서 찾은 저장소가 하나라 그 저장소를 썼습니다.</p>;
  }
  return (
    <>
      <p className="small muted repo-subhead">자동으로 고른 이유</p>
      <ReasonText reason={autoSelection.reason} />
    </>
  );
}

/** 선택 실행의 이유에 넘기는 값. */
interface ReasonTextProps {
  /** 에이전트가 적은 이유. 비어 있을 수 있다. */
  reason: string;
}

/** 선택 실행이 적은 이유. 비어 있으면 "이유 없음"을 흐리게 보인다. */
function ReasonText({ reason }: ReasonTextProps) {
  return <p className={reason === '' ? 'muted' : undefined}>{reasonText(reason)}</p>;
}

/** 저장소 확인 필요 묶음의 저장소 영역 내용에 넘기는 값. */
interface RepoCheckBodyProps {
  /** 묶음 ID. 저장소 선택 창을 열 때 실어 보낸다. */
  bundleId: number;
  /** 사유. 자동 선택이 생기기 전에 사유 없이 저장소 확인 필요가 되었으면 `null`. */
  repoCheck: RepoCheckSnapshot | null;
}

/** 저장소 확인 필요 묶음의 저장소 영역 내용. 사유와 그 내용 아래에 저장소 선택 창을 여는 [저장소를 골라 만들기]를 둔다. */
function RepoCheckBody({ bundleId, repoCheck }: RepoCheckBodyProps) {
  /** 저장소 선택 창을 연다. */
  const handleOpenPicker = () => {
    void window.stardraft.send({ type: 'open-repo-picker', bundleId });
  };

  return (
    <>
      <RepoCheckReason repoCheck={repoCheck} />
      <div className="repo-check-actions">
        <button type="button" className="btn" onClick={handleOpenPicker}>
          저장소를 골라 만들기
        </button>
      </div>
    </>
  );
}

/** 저장소 확인 필요의 사유와 내용에 넘기는 값. */
interface RepoCheckReasonProps {
  /** 사유. */
  repoCheck: RepoCheckSnapshot;
}

/** 저장소 확인 필요의 사유. 첫 줄에 사유를 쓰고 그 아래에 사유마다 내용을 둔다. 사유가 없는 옛 묶음은 안내만 보인다. */
function RepoCheckReason({ repoCheck }: Pick<RepoCheckBodyProps, 'repoCheck'>) {
  if (!repoCheck) return <p className="small muted">{NO_REPOSITORY_NOTE}</p>;
  return (
    <>
      <p className="warning-text">{repoCheckText(repoCheck)}</p>
      <RepoCheckDetail repoCheck={repoCheck} />
    </>
  );
}

/**
 * 저장소 확인 필요 사유의 내용. 매핑된 폴더가 사라졌으면 그 폴더를, 작업 폴더에 후보가 없으면 확인할 곳을,
 * 선택 실행이 고르지 않았으면 에이전트의 사유와 후보를 보인다. 후보는 에이전트가 짚은 것을 먼저, 작업 폴더의 나머지를 뒤에 둔다.
 */
function RepoCheckDetail({ repoCheck }: RepoCheckReasonProps) {
  switch (repoCheck.kind) {
    case 'missing-folders':
      return (
        <ul className="repository-list">
          {repoCheck.paths.map((path) => (
            <li key={path}>
              <span className="small muted">{path}</span>
            </li>
          ))}
        </ul>
      );
    case 'no-candidates':
      return <p className="small muted">설정의 "저장소" 칸에서 작업 폴더를 확인하세요.</p>;
    case 'unsure':
    case 'unrelated':
      return (
        <>
          <ReasonText reason={repoCheck.reason} />
          {repoCheck.picked.length > 0 && (
            <>
              <p className="small muted repo-subhead">에이전트가 짚은 후보</p>
              <RepositoryList repositories={repoCheck.picked} />
            </>
          )}
          {repoCheck.others.length > 0 && (
            <>
              <p className="small muted repo-subhead">
                {repoCheck.picked.length > 0 ? '작업 폴더의 다른 후보' : '작업 폴더의 후보'} {repoCheck.others.length}개
              </p>
              <RepositoryList repositories={repoCheck.others} />
            </>
          )}
        </>
      );
  }
}

/** 진행 영역에 넘기는 값. */
interface GenerationBodyProps {
  /** 생성 중 묶음의 진행. */
  generation: GenerationSnapshot;
}

/** 생성 중 묶음의 진행 영역 내용. 마지막 진행 단계 한 줄과 읽은 파일 수다. */
function GenerationBody({ generation }: GenerationBodyProps) {
  return (
    <div className="progress-line" role="status">
      <span>{generationStepText(generation)}</span>
      {generation.status === 'running' && <span className="small muted">읽은 파일 {generation.filesRead}개</span>}
    </div>
  );
}

/** 오류 영역에 넘기는 값. */
interface FailureBodyProps {
  /** 생성이 실패한 까닭. */
  failure: FailureSnapshot;
}

/** 실패 묶음의 오류 영역 내용. 쉬운 말 오류, 에이전트가 알려 준 오류 원문, 마지막 단계다. */
function FailureBody({ failure }: FailureBodyProps) {
  return (
    <div className="failure-box">
      <strong>{failureText(failure)}</strong>
      {failure.detail && <p className="failure-detail">{failure.detail}</p>}
      {failure.lastStep && <p className="failure-detail">마지막 단계: {failure.lastStep}</p>}
    </div>
  );
}

/** 상세 영역에 넘기는 값. */
interface BundleSectionsProps extends BundleProps {
  /** 영역이 있는 창. */
  windowKind: ReviewWindow;
  /** 창마다 영역의 펼침 상태. */
  sections: ReviewSnapshot['sections'];
}

/**
 * 묶음 상세의 알림 줄과 영역. 늘 원문이 먼저다.
 * 초안이 있으면 작은 창은 요구 → 초안 → 근거 → 저장소, 펼친 창은 요구 → 저장소 → 초안 → 근거 순이다.
 * 생성 중이면 진행, 실패면 오류, 저장소 확인 필요면 저장소 영역에 사유를 둔다.
 */
export function BundleSections({ bundle, windowKind, sections }: BundleSectionsProps) {
  /** 이 창의 영역 펼침 상태. */
  const open = sections[windowKind];
  // "스레드 보기"는 보고 있는 묶음에만 펼친다. 다른 묶음으로 넘어가면 다시 멘션만 보인다.
  /** "스레드 보기"로 펼친 묶음 ID. 펼치지 않았으면 `null`. */
  const [threadBundleId, setThreadBundleId] = useState<number | null>(null);
  /** "스레드 보기"를 펼치거나 접는다. */
  const handleToggleThread = () => setThreadBundleId((current) => (current === bundle.id ? null : bundle.id));
  // 요구를 고치는 칸도 보고 있는 묶음에만 연다. 다른 묶음으로 넘어가면 닫힌다.
  /** 요구를 고치는 칸을 연 묶음 ID. 열지 않았으면 `null`. */
  const [requirementBundleId, setRequirementBundleId] = useState<number | null>(null);
  /** 초안. 생성 중이면 새로 만들고 있으므로 보이지 않는다. */
  const draft = bundle.status === 'generating' ? null : bundle.draft;
  /** 요구를 고치는 칸을 보일지 여부. 초안을 고칠 수 있는 묶음에서만 연다. */
  const editingRequirement = requirementBundleId === bundle.id && draft?.canEdit === true;
  /** 망치 버튼을 눌렀다. 요구 영역이 접혀 있으면 펼치고 요구를 고치는 칸을 연다. */
  const handleFixRequirement = () => {
    if (!open.requirement) void window.stardraft.send({ type: 'set-review-section', window: windowKind, section: 'requirement', open: true });
    setRequirementBundleId(bundle.id);
  };
  /** 저장소 영역. 초안을 만들 때 쓴 저장소와 자동으로 고른 까닭, 또는 저장소 확인 필요 사유를 보인다. */
  const repository = (draft || bundle.status === 'repo-check-needed') && (
    <ReviewSectionBlock windowKind={windowKind} section="repository" open={open.repository} title="저장소">
      {draft ? <DraftRepositories bundleId={bundle.id} draft={draft} /> : <RepoCheckBody bundleId={bundle.id} repoCheck={bundle.repoCheck} />}
    </ReviewSectionBlock>
  );

  return (
    <>
      {bundle.newMentionCount > 0 && <NewMentionNotice bundle={bundle} />}
      <ReviewSectionBlock windowKind={windowKind} section="original" open={open.original} title="원문" detail={`멘션 ${bundle.mentions.length}건`}>
        <OriginalBody bundle={bundle} threadOpen={threadBundleId === bundle.id} onToggleThread={handleToggleThread} />
      </ReviewSectionBlock>
      {bundle.generation && (
        <ReviewSectionBlock windowKind={windowKind} section="progress" open={open.progress} title="진행">
          <GenerationBody generation={bundle.generation} />
        </ReviewSectionBlock>
      )}
      {bundle.status === 'failed' && bundle.failure && (
        <ReviewSectionBlock windowKind={windowKind} section="progress" open={open.progress} title="오류">
          <FailureBody failure={bundle.failure} />
        </ReviewSectionBlock>
      )}
      {draft && (
        <ReviewSectionBlock
          windowKind={windowKind}
          section="requirement"
          open={open.requirement}
          title="에이전트가 이해한 요구"
          action={draft.canEdit && <FixRequirementButton onClick={handleFixRequirement} />}
        >
          {editingRequirement ? (
            <RequirementEditor
              bundleId={bundle.id}
              requirement={draft.requirement.text}
              directiveCount={bundle.directives.length}
              edited={draft.edited}
              onClose={() => setRequirementBundleId(null)}
            />
          ) : (
            <p className="requirement-text">{draft.requirement.text}</p>
          )}
        </ReviewSectionBlock>
      )}
      {windowKind === 'expanded' && repository}
      {draft && (
        <>
          <ReviewSectionBlock windowKind={windowKind} section="draft" open={open.draft} title="초안">
            <DraftEditor key={bundle.id} bundleId={bundle.id} draft={draft} />
          </ReviewSectionBlock>
          <ReviewSectionBlock windowKind={windowKind} section="evidence" open={open.evidence} title={`근거 ${draft.evidence.length}개`}>
            <EvidenceList draft={draft} />
          </ReviewSectionBlock>
        </>
      )}
      {windowKind === 'compact' && repository}
    </>
  );
}

/** 바닥 줄에 넘기는 값. */
interface BundleFooterProps extends BundleProps {
  /** [무시]를 눌렀다. */
  onIgnore: () => void;
  /** [되돌리기]를 눌렀다. */
  onRestore: () => void;
  /** 생성 중 묶음의 [취소]를 눌렀다. */
  onCancel: () => void;
  /** 실패 묶음의 [다시 시도]를 눌렀다. */
  onRetry: () => void;
}

/**
 * 상세 바닥 줄. 처리되지 않은 묶음은 왼쪽에 [무시], 처리됨 묶음은 안내와 [되돌리기]다.
 * 생성 중 묶음은 [취소]만 있고, 실패 묶음은 오른쪽에 [다시 시도]가, 준비됨 묶음은 오른쪽에 재생성 메뉴가 있다.
 * 재생성 메뉴에서 지시를 덧붙이기로 하면 바닥 줄이 지시를 쓰는 칸이 되고, 편집한 초안이 있으면 다시 만들기 전에 바닥 줄에서 버릴지 묻는다.
 */
export function BundleFooter({ bundle, onIgnore, onRestore, onCancel, onRetry }: BundleFooterProps) {
  // 바닥 줄의 칸은 보고 있는 묶음에만 연다. 다른 묶음으로 넘어가거나 준비됨이 아니게 되면 닫힌다.
  /** 바닥 줄에 연 칸과 그 묶음 ID. 지시를 쓰는 칸이거나, 그 경로로 다시 만들기 전에 편집본을 버릴지 묻는 칸이다. 열지 않았으면 `null`. */
  const [pane, setPane] = useState<{ bundleId: number; kind: RegenerateChoice } | null>(null);
  /** 지금 묶음에 연 칸. */
  const openPane = bundle.status === 'ready' && bundle.draft && pane?.bundleId === bundle.id ? pane.kind : null;
  /** 칸을 닫는다. */
  const closePane = () => setPane(null);
  /** 재생성 메뉴에서 고른 경로를 한다. 편집한 초안이 있으면 먼저 버릴지 묻고, 지시를 덧붙이면 지시를 쓰는 칸을 연다. */
  const handlePick = (choice: RegenerateChoice) => {
    if (choice === 'directive') setPane({ bundleId: bundle.id, kind: 'directive' });
    else if (bundle.draft?.edited) setPane({ bundleId: bundle.id, kind: choice });
    else sendRegeneration(bundle.id, choice);
  };

  if (openPane === 'directive') {
    return (
      <footer className="review-foot stacked">
        <DirectiveForm bundleId={bundle.id} directives={bundle.directives} edited={bundle.draft?.edited === true} onClose={closePane} />
      </footer>
    );
  }
  if (openPane === 'again' || openPane === 'other-repos') {
    /** 편집본을 버리고 고른 경로로 다시 만든다. */
    const handleConfirm = () => {
      closePane();
      sendRegeneration(bundle.id, openPane);
    };
    return (
      <footer className="review-foot">
        <DiscardEditConfirm onConfirm={handleConfirm} onCancel={closePane} />
      </footer>
    );
  }
  if (bundle.status === 'generating') {
    return (
      <footer className="review-foot">
        <span className="small muted">초안을 만드는 중입니다.</span>
        <span className="spacer" />
        <button type="button" className="btn" onClick={onCancel}>
          취소
        </button>
      </footer>
    );
  }
  if (bundle.group === 'processed') {
    return (
      <footer className="review-foot">
        <span className="small muted">{PROCESSED_NOTES[bundle.status] ?? ''}</span>
        <span className="spacer" />
        {bundle.canRestore && (
          <button type="button" className="btn" onClick={onRestore}>
            되돌리기
          </button>
        )}
      </footer>
    );
  }
  return (
    <footer className="review-foot">
      <button type="button" className="btn" onClick={onIgnore}>
        무시
      </button>
      <span className="spacer" />
      {bundle.status === 'failed' && (
        <button type="button" className="btn primary" onClick={onRetry}>
          다시 시도
        </button>
      )}
      {bundle.status === 'ready' && <RegenerateMenu onPick={handlePick} />}
    </footer>
  );
}

/** 재생성 메뉴의 항목. 다시 만들기, 지시를 덧붙여 다시 만들기, 다른 저장소로 다시 만들기다. */
type RegenerateChoice = 'again' | 'directive' | 'other-repos';

/** 재생성 메뉴 항목의 이름. 메뉴에 이 순서로 보인다. */
const REGENERATE_CHOICES: readonly { choice: RegenerateChoice; label: string }[] = [
  { choice: 'again', label: '다시 만들기' },
  { choice: 'directive', label: '지시를 덧붙여 다시 만들기' },
  { choice: 'other-repos', label: '다른 저장소로 다시 만들기' },
];

/** 묻지 않고 바로 하는 재생성을 main에 보낸다. 다시 만들기는 바로 다시 만들고, 다른 저장소로 다시 만들기는 저장소 선택 창을 연다. */
function sendRegeneration(bundleId: number, choice: Exclude<RegenerateChoice, 'directive'>) {
  void window.stardraft.send(choice === 'again' ? { type: 'regenerate-bundle', bundleId } : { type: 'open-repo-picker', bundleId });
}

/** 재생성 메뉴에 넘기는 값. */
interface RegenerateMenuProps {
  /** 메뉴 항목을 골랐다. */
  onPick: (choice: RegenerateChoice) => void;
}

/** 준비됨 묶음의 재생성 메뉴. 바닥 줄 위로 펼치고, 항목을 고르면 닫는다. */
function RegenerateMenu({ onPick }: RegenerateMenuProps) {
  return (
    <details className="menu">
      <summary className="btn">다시 만들기 ▾</summary>
      <div className="menu-list" role="menu">
        {REGENERATE_CHOICES.map(({ choice, label }) => (
          <button
            key={choice}
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={(event) => {
              event.currentTarget.closest('details')?.removeAttribute('open');
              onPick(choice);
            }}
          >
            {label}
          </button>
        ))}
      </div>
    </details>
  );
}

/** 편집본을 버릴지 묻는 줄에 넘기는 값. */
interface DiscardEditConfirmProps {
  /** [버리고 다시 만들기]를 눌렀다. */
  onConfirm: () => void;
  /** [취소]를 눌렀다. */
  onCancel: () => void;
}

/** 편집한 초안이 있는 묶음을 다시 만들기 전에 편집본을 버릴지 묻는 줄. */
export function DiscardEditConfirm({ onConfirm, onCancel }: DiscardEditConfirmProps) {
  return (
    <div className="confirm-line" role="alertdialog" aria-label="편집본 버리기">
      <span>편집한 초안을 버리고 다시 만들까요?</span>
      <span className="spacer" />
      <button type="button" className="btn" onClick={onCancel}>
        취소
      </button>
      <button type="button" className="btn primary" onClick={onConfirm}>
        버리고 다시 만들기
      </button>
    </div>
  );
}

/** 편집한 초안을 버리고 다시 만든다는 안내. 지시나 고친 요구를 쓰는 칸에 보인다. */
const DISCARD_EDIT_NOTE = '편집한 초안은 버리고 다시 만듭니다.';

/** 지시를 쓰는 칸에 넘기는 값. */
interface DirectiveFormProps {
  /** 다시 만들 묶음 ID. */
  bundleId: number;
  /** 앞서 덧붙인 지시. 덧붙인 순서다. */
  directives: string[];
  /** 초안을 편집했는지 여부. 참이면 편집본을 버린다고 알린다. */
  edited: boolean;
  /** 칸을 닫는다. 보내거나 [취소]를 누르면 부른다. */
  onClose: () => void;
}

/**
 * 지시를 덧붙여 다시 만드는 칸. 바닥 줄 자리에 열린다. 앞서 덧붙인 지시가 있으면 함께 넘긴다고 보이고,
 * 편집한 초안이 있으면 버린다고 알리며 버튼 이름에도 적는다. 빈 지시로는 보낼 수 없다.
 */
export function DirectiveForm({ bundleId, directives, edited, onClose }: DirectiveFormProps) {
  /** 쓰고 있는 지시. */
  const [text, setText] = useState('');
  /** 지시를 덧붙여 다시 만든다. */
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (text.trim() === '') return;
    void window.stardraft.send({ type: 'regenerate-with-directive', bundleId, directive: text });
    onClose();
  };

  return (
    <form className="regen-form" onSubmit={handleSubmit}>
      <label className="field-label" htmlFor={`directive-${bundleId}`}>
        덧붙일 지시
      </label>
      {directives.length > 0 && (
        <>
          <p className="small muted">앞서 덧붙인 지시도 함께 넘깁니다.</p>
          <ol className="directive-list small">
            {directives.map((directive, index) => (
              <li key={index}>{directive}</li>
            ))}
          </ol>
        </>
      )}
      <textarea
        id={`directive-${bundleId}`}
        className="text-input regen-input"
        value={text}
        placeholder="예: 더 짧게 써 주세요."
        autoFocus
        onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setText(event.target.value)}
      />
      {edited && <p className="small warning-text">{DISCARD_EDIT_NOTE}</p>}
      <div className="regen-actions">
        <button type="button" className="btn" onClick={onClose}>
          취소
        </button>
        <span className="spacer" />
        <button type="submit" className="btn primary" disabled={text.trim() === ''}>
          {edited ? '편집본을 버리고 다시 만들기' : '지시를 덧붙여 다시 만들기'}
        </button>
      </div>
    </form>
  );
}

/** 망치 버튼에 넘기는 값. */
interface FixRequirementButtonProps {
  /** 눌렀다. */
  onClick: () => void;
}

/** "에이전트가 이해한 요구" 제목 옆의 망치 버튼. 요구를 고치는 칸을 연다. */
function FixRequirementButton({ onClick }: FixRequirementButtonProps) {
  return (
    <button type="button" className="icon-btn" aria-label="요구 고치기" title="요구 고치기" onClick={onClick}>
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round">
        <path d="M6.5 3.5 9 1l4.5 4.5L11 8z" />
        <path d="M8 6 2.2 11.8a1.3 1.3 0 0 0 1.9 1.9L10 7.9" />
      </svg>
    </button>
  );
}

/** 요구를 고치는 칸에 넘기는 값. */
interface RequirementEditorProps {
  /** 다시 만들 묶음 ID. */
  bundleId: number;
  /** 지금 요구. 칸에 채워 둔다. */
  requirement: string;
  /** 앞서 덧붙인 지시 수. 요구를 고치면 지워진다고 알린다. */
  directiveCount: number;
  /** 초안을 편집했는지 여부. 참이면 편집본을 버린다고 알린다. */
  edited: boolean;
  /** 칸을 닫는다. 보내거나 [취소]를 누르면 부른다. */
  onClose: () => void;
}

/**
 * 요구를 고쳐 "이 요구로 재생성"하는 칸. 요구 영역 안에 열리고 지금 요구를 채워 둔다.
 * 덧붙인 지시가 지워지는 것과 편집한 초안을 버리는 것을 먼저 알리고, 편집한 초안이 있으면 버튼 이름에도 적는다. 빈 요구로는 보낼 수 없다.
 */
export function RequirementEditor({ bundleId, requirement, directiveCount, edited, onClose }: RequirementEditorProps) {
  /** 고치고 있는 요구. */
  const [text, setText] = useState(requirement);
  /** 고친 요구로 다시 만든다. */
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (text.trim() === '') return;
    void window.stardraft.send({ type: 'fix-requirement', bundleId, requirement: text });
    onClose();
  };

  return (
    <form className="regen-form" onSubmit={handleSubmit}>
      <textarea
        className="text-input regen-input"
        aria-label="고친 요구"
        value={text}
        autoFocus
        onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setText(event.target.value)}
      />
      {directiveCount > 0 && <p className="small muted">덧붙인 지시 {directiveCount}개는 지워집니다.</p>}
      {edited && <p className="small warning-text">{DISCARD_EDIT_NOTE}</p>}
      <div className="regen-actions">
        <button type="button" className="btn" onClick={onClose}>
          취소
        </button>
        <span className="spacer" />
        <button type="submit" className="btn primary" disabled={text.trim() === ''}>
          {edited ? '편집본을 버리고 이 요구로 재생성' : '이 요구로 재생성'}
        </button>
      </div>
    </form>
  );
}

/**
 * 합쳐진 새 멘션의 알림 줄. 준비됨 묶음이면 [다시 만들기]를 두어 새 멘션까지 넣어 다시 만든다.
 * 편집한 초안이 있으면 같은 줄에서 먼저 버릴지 묻는다. 저장소 확인 필요처럼 초안이 없는 묶음은 수만 보인다.
 */
function NewMentionNotice({ bundle }: BundleProps) {
  /** 편집본을 버릴지 묻고 있는 묶음 ID. 묻지 않으면 `null`. */
  const [confirmingBundleId, setConfirmingBundleId] = useState<number | null>(null);
  /** 새 멘션까지 넣어 다시 만들 수 있는지 여부. */
  const canRegenerate = bundle.status === 'ready' && bundle.draft !== null;
  /** [다시 만들기]를 눌렀다. 편집한 초안이 있으면 먼저 묻는다. */
  const handleRegenerate = () => {
    if (bundle.draft?.edited) setConfirmingBundleId(bundle.id);
    else sendRegeneration(bundle.id, 'again');
  };

  if (canRegenerate && confirmingBundleId === bundle.id) {
    /** 편집본을 버리고 다시 만든다. */
    const handleConfirm = () => {
      setConfirmingBundleId(null);
      sendRegeneration(bundle.id, 'again');
    };
    return (
      <div className="notice-line">
        <DiscardEditConfirm onConfirm={handleConfirm} onCancel={() => setConfirmingBundleId(null)} />
      </div>
    );
  }
  return (
    <div className="notice-line">
      <span>새 멘션 {bundle.newMentionCount}건</span>
      {canRegenerate && (
        <button type="button" className="btn sm" onClick={handleRegenerate}>
          다시 만들기
        </button>
      )}
    </div>
  );
}

/** 무시 토스트에 넘기는 값. */
interface IgnoreToastProps {
  /** 보일 토스트. */
  toast: IgnoreToastState;
  /** [되돌리기]를 눌렀다. */
  onRestore: () => void;
}

/** 무시한 직후 창 아래에 뜨는 토스트. 5초 안에 [되돌리기]로 살릴 수 있다. */
export function IgnoreToast({ toast, onRestore }: IgnoreToastProps) {
  return (
    <div className="toast" role="status">
      <span>{toast.text}</span>
      <button type="button" className="btn link" onClick={onRestore}>
        되돌리기
      </button>
    </div>
  );
}
