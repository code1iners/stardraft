import { useEffect, useRef, type KeyboardEvent } from 'react';
import type { FlowAccountProfile } from '../../shared/ipc';

/** 계정 바꾸기 확인 창에 넘기는 값. */
interface AccountSwitchModalProps {
  /** 새로 넣은 키의 계정. */
  account: FlowAccountProfile;
  /** 지금 계정. 기록을 보관할 계정이다. */
  current: FlowAccountProfile | null;
  /** 새로 넣은 키의 계정 기록을 보관해 두었는지(돌아오는 계정인지) 여부. */
  stored: boolean;
}

/**
 * 다른 계정의 키를 넣었을 때 계정을 바꾸기 전에 확인을 받는 모달. 기록은 지우지 않지만, 키를 잘못 붙여 넣으면
 * 만들던 초안과 게시 대기가 멈추므로 묻는다. 화면 가운데 모달로 뜨고, 고를 때까지 main은 아무것도 바꾸지 않는다.
 * 한 사람이 두 회사를 다니면 두 계정의 이름이 같으므로 제목에 이메일을 함께 적는다.
 */
export function AccountSwitchModal({ account, current, stored }: AccountSwitchModalProps) {
  /** 지금 계정을 가리키는 말. 소속을 모르면 이메일로 가린다. */
  const currentLabel = current ? current.division || current.email : '';
  /** 지금 계정의 기록을 보관한다는 문장. */
  const keepCurrent = `지금 계정(${currentLabel})의 기록은 30일 동안 보관합니다.`;
  /** 처음 넣는 계정과 보관해 둔 계정에서 갈리는 본문. */
  const body = stored ? `보관한 기록을 이어서 씁니다. ${keepCurrent}` : `${keepCurrent} 그 안에 돌아오면 이어서 쓸 수 있습니다.`;
  /** 처음 초점을 줄 [취소] 버튼. 키를 잘못 붙여 넣었을 때 계정을 실수로 바꾸지 않게 한다. */
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(function focusCancelOnOpen() {
    cancelRef.current?.focus();
  }, []);

  /** 지금 계정의 기록을 보관하고 새 계정으로 바꾼다. */
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
    <div className="modal-backdrop">
      <div
        className="modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="account-switch-title"
        aria-describedby="account-switch-body"
        onKeyDown={handleKeyDown}
      >
        <h3 id="account-switch-title">
          {account.name}({account.email}) 계정의 키입니다
        </h3>
        <p id="account-switch-body">{body}</p>
        <p className="muted small">만들던 초안과 게시 대기는 멈춥니다.</p>
        <div className="modal-actions">
          <button ref={cancelRef} type="button" className="btn" onClick={handleCancel}>
            취소
          </button>
          <button type="button" className="btn primary" onClick={handleConfirm}>
            계정 바꾸기
          </button>
        </div>
      </div>
    </div>
  );
}
