import { useState, type ReactNode } from 'react';
import type {
  BundleSnapshot,
  BundleStatusSnapshot,
  ReviewSection,
  ReviewSnapshot,
  ReviewWindow,
  TextPartSnapshot,
  ThreadEntrySnapshot,
} from '../../shared/ipc';
import {
  BUNDLE_PLACE_LABELS,
  BUNDLE_STATUS_TAGS,
  formatMentionTime,
  MENTION_PLACE_LABELS,
  postLine,
  PROCESSED_NOTES,
  senderLine,
} from './review-text';
import type { IgnoreToastState } from './useReview';

/** 저장소 확인 필요 묶음의 저장소 영역 안내. 저장소를 고르는 창이 생기면 사유·후보·[저장소를 골라 만들기]가 들어간다. */
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

/** 작은 창 상세 머리. 첫 줄은 송신자·멘션 자리·시각, 둘째 줄은 게시물과 "Flow에서 열기"다. */
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
  /** 펼쳤을 때 보일 내용. */
  children: ReactNode;
}

/** 머리를 눌러 접고 펴는 상세 영역. 펼침 상태는 main이 창마다 기억한다. */
function ReviewSectionBlock({ windowKind, section, open, title, detail, children }: ReviewSectionBlockProps) {
  /** 영역을 접거나 편다. */
  const handleToggle = () => {
    void window.stardraft.send({ type: 'set-review-section', window: windowKind, section, open: !open });
  };

  return (
    <section className="review-section">
      <button type="button" className="section-toggle" aria-expanded={open} onClick={handleToggle}>
        <span className="section-chevron" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        <span>{title}</span>
        {detail && <span className="section-detail">{detail}</span>}
      </button>
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

/** 상세 영역에 넘기는 값. */
interface BundleSectionsProps extends BundleProps {
  /** 영역이 있는 창. */
  windowKind: ReviewWindow;
  /** 창마다 영역의 펼침 상태. */
  sections: ReviewSnapshot['sections'];
}

/** 묶음 상세의 알림 줄과 영역. 원문 → 저장소 순서이고, 저장소 영역은 저장소 확인 필요 묶음에만 있다. */
export function BundleSections({ bundle, windowKind, sections }: BundleSectionsProps) {
  /** 이 창의 영역 펼침 상태. */
  const open = sections[windowKind];
  // "스레드 보기"는 보고 있는 묶음에만 펼친다. 다른 묶음으로 넘어가면 다시 멘션만 보인다.
  /** "스레드 보기"로 펼친 묶음 ID. 펼치지 않았으면 `null`. */
  const [threadBundleId, setThreadBundleId] = useState<number | null>(null);
  /** "스레드 보기"를 펼치거나 접는다. */
  const handleToggleThread = () => setThreadBundleId((current) => (current === bundle.id ? null : bundle.id));

  return (
    <>
      {bundle.newMentionCount > 0 && <p className="notice-line">새 멘션 {bundle.newMentionCount}건</p>}
      <ReviewSectionBlock windowKind={windowKind} section="original" open={open.original} title="원문" detail={`멘션 ${bundle.mentions.length}건`}>
        <OriginalBody bundle={bundle} threadOpen={threadBundleId === bundle.id} onToggleThread={handleToggleThread} />
      </ReviewSectionBlock>
      {bundle.status === 'repo-check-needed' && (
        <ReviewSectionBlock windowKind={windowKind} section="repository" open={open.repository} title="저장소">
          <p className="small muted">{NO_REPOSITORY_NOTE}</p>
        </ReviewSectionBlock>
      )}
    </>
  );
}

/** 바닥 줄에 넘기는 값. */
interface BundleFooterProps extends BundleProps {
  /** [무시]를 눌렀다. */
  onIgnore: () => void;
  /** [되돌리기]를 눌렀다. */
  onRestore: () => void;
}

/** 상세 바닥 줄. 처리되지 않은 묶음은 왼쪽에 [무시], 처리됨 묶음은 안내와 [되돌리기]다. */
export function BundleFooter({ bundle, onIgnore, onRestore }: BundleFooterProps) {
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
    </footer>
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
