import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { ManualCheckSnapshot } from '../../shared/ipc';
import { MANUAL_CHECK_DISABLED_TEXT } from './ManualCheck';

/** 메뉴에서 키를 눌렀을 때 할 일. 항목으로 옮기거나(`focus`), 메뉴를 닫는다(`close`). */
export type MenuKeyAction = { kind: 'focus'; index: number } | { kind: 'close'; restoreFocus: boolean };

/**
 * 열린 메뉴에서 누른 키가 하는 일. 모르는 키는 `null`이라 그대로 둔다.
 * 위·아래는 쓸 수 있는 항목만 돌며 끝에서 반대쪽으로 이어지고, Esc는 트리거로 포커스를 돌려주며 닫고, Tab은 포커스를 두고 닫는다.
 * @param key 누른 키.
 * @param current 지금 포커스가 있는 항목 위치. 없으면 -1.
 * @param enabled 항목마다 쓸 수 있는지 여부. 메뉴에 보이는 순서다.
 */
export function menuKeyAction(key: string, current: number, enabled: readonly boolean[]): MenuKeyAction | null {
  if (key === 'Escape') return { kind: 'close', restoreFocus: true };
  if (key === 'Tab') return { kind: 'close', restoreFocus: false };

  /** 쓸 수 있는 항목의 위치. */
  const usable = enabled.flatMap((ok, index) => (ok ? [index] : []));
  /** 맨 앞과 맨 뒤의 쓸 수 있는 항목. 쓸 수 있는 항목이 없으면 없다. */
  const first = usable.at(0);
  const last = usable.at(-1);
  if (first === undefined || last === undefined) return null;
  if (key === 'Home') return { kind: 'focus', index: first };
  if (key === 'End') return { kind: 'focus', index: last };
  if (key === 'ArrowDown') return { kind: 'focus', index: usable.find((index) => index > current) ?? first };
  if (key === 'ArrowUp') return { kind: 'focus', index: usable.findLast((index) => index < current) ?? last };
  return null;
}

/** ⋯ 메뉴에 넘기는 값. */
interface PopoverMenuProps {
  /** 최근 멘션 확인 상태. 항목이 막혔는지는 여기서 읽는다. */
  manualCheck: ManualCheckSnapshot;
  /** "펼쳐 보기"를 쓸 수 있는지 여부. 펼칠 묶음이 없으면 항목을 두지 않는다. */
  canExpand: boolean;
  /** "펼쳐 보기"를 골랐다. */
  onExpand: () => void;
  /** 처음부터 열어 둘지 여부. 화면 테스트에서 열린 모양을 그릴 때만 쓴다. */
  defaultOpen?: boolean;
}

/**
 * 작은 창 머리의 ⋯ 메뉴. "최근 멘션 확인"과 "펼쳐 보기"를 담아 머리를 깔끔하게 둔다.
 * 감지를 시작하지 않았거나 쓸 수 있는 Flow 키가 없으면 "최근 멘션 확인"이 막히고 까닭이 메뉴에 보인다.
 * 트리거를 누르거나 ↓를 누르면 열려 첫 항목에 포커스가 가고, ↑↓ Home End로 옮기며, Esc로 닫으면 트리거로 돌아간다.
 */
export function PopoverMenu({ manualCheck, canExpand, onExpand, defaultOpen = false }: PopoverMenuProps) {
  /** 메뉴가 열렸는지 여부. */
  const [open, setOpen] = useState(defaultOpen);
  /** 메뉴 전체. 바깥을 눌렀는지 가리는 데 쓴다. */
  const rootRef = useRef<HTMLDivElement>(null);
  /** 메뉴를 여는 버튼. */
  const triggerRef = useRef<HTMLButtonElement>(null);
  /** 메뉴 항목 버튼들. 보이는 순서다. */
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  /** 열 때 첫 항목으로 포커스를 옮길지 여부. 마우스로 열면 옮기지 않는다. */
  const focusOnOpen = useRef(false);

  /** 메뉴 항목. 보이는 순서다. */
  const items = [
    {
      key: 'manual-check',
      label: '최근 멘션 확인',
      enabled: manualCheck.canOpen,
      /** 막혔을 때 항목 아래에 보일 까닭. */
      reason: manualCheck.canOpen ? null : MANUAL_CHECK_DISABLED_TEXT,
      onPick: () => void window.stardraft.send({ type: 'open-manual-check', window: 'popover' }),
    },
    ...(canExpand ? [{ key: 'expand', label: '펼쳐 보기', enabled: true, reason: null, onPick: onExpand }] : []),
  ];
  /** 항목마다 쓸 수 있는지 여부. */
  const enabled = items.map((item) => item.enabled);

  // 열려 있는 동안 메뉴 바깥을 누르면 닫는다. 열릴 때 키보드로 열었으면 첫 항목에 포커스를 둔다.
  useEffect(() => {
    if (!open) return;
    if (focusOnOpen.current) {
      focusOnOpen.current = false;
      const first = enabled.indexOf(true);
      if (first >= 0) itemRefs.current[first]?.focus();
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
    // 항목 구성이 바뀌어도 포커스를 다시 옮기지 않도록 열림 여부만 본다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /** 트리거에서 ↓를 누르면 열고 첫 항목으로 간다. Enter·Space는 버튼의 클릭이 처리한다. */
  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowDown') return;
    event.preventDefault();
    focusOnOpen.current = true;
    setOpen(true);
  };

  /** 트리거를 눌러 연다. 이미 열렸으면 닫는다. 키보드로 눌렀으면 첫 항목으로 간다. */
  const handleTriggerClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    // 키보드로 누른 클릭은 detail이 0이다.
    focusOnOpen.current = !open && event.detail === 0;
    setOpen(!open);
  };

  /** 열린 메뉴의 키 조작. */
  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    /** 포커스가 있는 항목 위치. */
    const current = itemRefs.current.findIndex((item) => item === document.activeElement);
    /** 누른 키가 하는 일. */
    const action = menuKeyAction(event.key, current, enabled);
    if (!action) return;
    event.preventDefault();
    // Esc가 시트나 창의 닫기까지 번지지 않게 한다.
    event.stopPropagation();
    if (action.kind === 'focus') {
      itemRefs.current[action.index]?.focus();
      return;
    }
    setOpen(false);
    if (action.restoreFocus) triggerRef.current?.focus();
  };

  return (
    <div className="menu popover-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="popover-menu-trigger"
        aria-label="메뉴 열기"
        title="메뉴"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={handleTriggerClick}
        onKeyDown={handleTriggerKeyDown}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.7" />
          <circle cx="12" cy="12" r="1.7" />
          <circle cx="19" cy="12" r="1.7" />
        </svg>
      </button>
      {open && (
        <div className="menu-list popover-menu-list" role="menu" aria-label="작은 창 메뉴" onKeyDown={handleMenuKeyDown}>
          {items.map((item, index) => (
            <div key={item.key}>
              <button
                ref={(node) => {
                  itemRefs.current[index] = node;
                }}
                type="button"
                role="menuitem"
                className="menu-item"
                disabled={!item.enabled}
                aria-describedby={item.reason ? `popover-menu-reason-${item.key}` : undefined}
                onClick={() => {
                  setOpen(false);
                  item.onPick();
                }}
              >
                {item.label}
              </button>
              {item.reason && (
                <p id={`popover-menu-reason-${item.key}`} className="menu-reason small muted">
                  {item.reason}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
