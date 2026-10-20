import { useEffect, useRef, type KeyboardEvent } from 'react';
import type { FlowAccountProfile } from '../../shared/ipc';

/** 계정 바꾸기 확인 시트에 넘기는 값. */
interface AccountSwitchSheetProps {
  /** 새로 넣은 키의 계정. */
  account: FlowAccountProfile;
}

/**
 * 다른 계정의 키를 넣었을 때 지금까지의 기록을 지우기 전에 확인을 받는 시트.
 * 설정 창 위쪽에 붙어 창 전체를 덮고, 고를 때까지 main은 아무것도 바꾸지 않는다.
 */
export function AccountSwitchSheet({ account }: AccountSwitchSheetProps) {
  /** 처음 초점을 줄 [취소] 버튼. 기록을 지우는 쪽을 실수로 누르지 않게 한다. */
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(function focusCancelOnOpen() {
    cancelRef.current?.focus();
  }, []);

  /** 기록을 지우고 새 계정으로 바꾼다. */
  const handleConfirm = () => {
    void window.stardraft.send({ type: 'confirm-flow-account-switch' });
  };

  /** 바꾸지 않는다. 옛 키와 계정, 기록은 그대로다. */
  const handleCancel = () => {
    void window.stardraft.send({ type: 'cancel-flow-key-check' });
  };

  /** Esc는 [취소]와 같다. */
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') handleCancel();
  };

  return (
    <div className="sheet-backdrop">
      <div
        className="sheet"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="account-switch-title"
        aria-describedby="account-switch-body"
        onKeyDown={handleKeyDown}
      >
        <h3 id="account-switch-title">{account.name} 계정의 키입니다</h3>
        <p id="account-switch-body">지금까지의 멘션·초안·기록을 지우고 이 계정으로 처음부터 시작합니다.</p>
        <p className="muted small">작업 폴더, 저장소 매핑, 에이전트, 지침 같은 설정은 그대로 둡니다.</p>
        <div className="sheet-actions">
          <button ref={cancelRef} type="button" className="btn" onClick={handleCancel}>
            취소
          </button>
          <button type="button" className="btn primary" onClick={handleConfirm}>
            지우고 바꾸기
          </button>
        </div>
      </div>
    </div>
  );
}
