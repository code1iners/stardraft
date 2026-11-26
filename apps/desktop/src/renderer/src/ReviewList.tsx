import type { ReactNode } from 'react';
import { RETENTION_NOTE } from './review-text';

/** 목록 종류 묶음에 넘기는 값. */
interface ListKindGroupProps {
  /** 종류 이름. Flow 초안은 "초안", Sentry 진단은 "진단"이다. */
  title: string;
  /** 이 종류에 든 항목 수. */
  count: number;
  /** 이 종류의 줄들. */
  children: ReactNode;
}

/** 펼친 창 목록의 종류 묶음. 머리에 종류 이름과 항목 수를 보이고 그 아래에 줄을 둔다. 항목이 없는 종류는 그리는 쪽에서 건너뛴다. */
export function ListKindGroup({ title, count, children }: ListKindGroupProps) {
  return (
    <section>
      <h3 className="list-group-head">
        {title} {count}
      </h3>
      {children}
    </section>
  );
}

/** 목록 줄에 넘기는 값. */
interface ListRowProps {
  /** 지금 상세에 열린 줄인지 여부. */
  selected: boolean;
  /** 줄을 눌렀다. */
  onSelect: () => void;
  /** 첫 줄 왼쪽의 굵은 글. 초안은 송신자, 진단은 오류 제목이다. */
  title: string;
  /** 첫 줄 오른쪽의 시각 글. */
  time: string;
  /** 둘째 줄의 요약. */
  summary: string;
  /** 태그 줄에 놓을 태그들. 상태 태그는 `StateTag`로 그린다. */
  tags: ReactNode;
}

/** 목록의 줄 하나. 첫 줄에 제목과 시각, 둘째 줄에 요약, 셋째 줄에 태그를 둔다. 종류가 달라도 같은 모양을 쓴다. */
export function ListRow({ selected, onSelect, title, time, summary, tags }: ListRowProps) {
  return (
    <button type="button" className="list-row" aria-current={selected ? 'true' : undefined} onClick={onSelect}>
      <span className="list-row-top">
        <strong>{title}</strong>
        <span className="small muted">{time}</span>
      </span>
      <span className="list-row-sub">{summary}</span>
      <span className="list-row-tags">{tags}</span>
    </button>
  );
}

/** 상태 태그에 넘기는 값. */
interface StateTagProps {
  /** 태그 글. */
  label: string;
  /** 태그 색. 회색은 `generating`, 파랑은 `ready`, 빨강은 `failed`, 노랑은 `warn`, 초록은 `success`, 옅은 회색은 `done`, 테두리만 있는 표시는 `outline`이다. 없으면 색 없는 태그다. */
  tone?: 'generating' | 'ready' | 'failed' | 'warn' | 'done' | 'success' | 'outline';
}

/** 줄과 상세 머리에 쓰는 태그 한 개. 상태 이름과 색은 호출하는 쪽이 종류에 맞게 정한다. */
export function StateTag({ label, tone }: StateTagProps) {
  return <span className={tone ? `tag ${tone}` : 'tag'}>{label}</span>;
}

/** 끝낸 항목이 하나라도 있을 때 목록 맨 아래에 보이는 보관 안내 한 줄. */
export function ListRetentionNote() {
  return <p className="list-note">{RETENTION_NOTE}</p>;
}
