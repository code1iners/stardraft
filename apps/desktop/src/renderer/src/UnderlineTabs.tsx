import type { KeyboardEvent } from 'react';

/** 밑줄 탭 하나. */
export interface UnderlineTab<Id extends string> {
  /** 탭을 가리키는 값. */
  id: Id;
  /** 탭 이름. */
  label: string;
  /** 참이면 이름 옆에 점을 찍어 그 탭에 확인할 것이 있다고 알린다. */
  dot?: boolean;
}

/** 밑줄 탭에 넘기는 값. */
interface UnderlineTabsProps<Id extends string> {
  /** 탭 목록의 이름. 화면 읽기 프로그램이 읽는다. */
  label: string;
  /** 탭과 내용의 id 앞부분. 탭은 `${idPrefix}-tab-${id}`, 내용은 `${idPrefix}-panel-${id}`다. */
  idPrefix: string;
  /** 탭. 이 순서로 보인다. */
  tabs: readonly UnderlineTab<Id>[];
  /** 지금 고른 탭. */
  selected: Id;
  /** 탭을 골랐을 때. */
  onSelect: (id: Id) => void;
}

/**
 * 설정 칸 안의 밑줄형 탭. 고른 탭 아래에 강조색 밑줄을 긋고, 탭마다 점 하나까지 찍을 수 있다.
 * 왼쪽·오른쪽 화살표로 옆 탭을 고른다. 내용은 부르는 쪽이 `tabPanelId`의 id로 그린다.
 */
export function UnderlineTabs<Id extends string>({ label, idPrefix, tabs, selected, onSelect }: UnderlineTabsProps<Id>) {
  /** 화살표 키로 옆 탭을 고르고 그 탭에 초점을 옮긴다. */
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    /** 지금 탭의 위치. */
    const at = tabs.findIndex((tab) => tab.id === selected);
    /** 옮겨 갈 탭. 끝에서는 반대쪽 끝으로 돈다. */
    const next = tabs[(at + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
    if (!next) return;
    onSelect(next.id);
    document.getElementById(tabId(idPrefix, next.id))?.focus();
  };

  return (
    <div className="underline-tabs" role="tablist" aria-label={label} onKeyDown={handleKeyDown}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          id={tabId(idPrefix, tab.id)}
          aria-selected={tab.id === selected}
          aria-controls={tabPanelId(idPrefix, tab.id)}
          tabIndex={tab.id === selected ? 0 : -1}
          className="underline-tab"
          onClick={() => onSelect(tab.id)}
        >
          {tab.label}
          {tab.dot && <span className="underline-tab-dot" role="img" aria-label="확인 필요" />}
        </button>
      ))}
    </div>
  );
}

/** 탭 단추의 id. 탭 내용의 `aria-labelledby`가 가리킨다. */
export function tabId(idPrefix: string, id: string): string {
  return `${idPrefix}-tab-${id}`;
}

/** 탭 내용의 id. 내용에 `role="tabpanel"`과 함께 붙이고 `aria-labelledby`로 탭 단추 id를 가리킨다. */
export function tabPanelId(idPrefix: string, id: string): string {
  return `${idPrefix}-panel-${id}`;
}
