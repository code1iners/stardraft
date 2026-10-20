import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  FLOW_API_KEY_MAX_LENGTH,
  type FlowAccountProfile,
  type FlowAccountSnapshot,
  type FlowKeyCheckFailure,
} from '../../shared/ipc';

/** 키 확인이 실패했을 때 입력 칸 아래에 보일 문구. */
const FAILURE_MESSAGES: Record<FlowKeyCheckFailure, string> = {
  unauthorized: '키가 맞지 않습니다. Flow에서 다시 복사해 붙여 넣어 주세요.',
  network: 'Flow에 연결할 수 없습니다. 인터넷 연결을 확인해 주세요.',
  'rate-limited': 'Flow 요청이 많아 확인하지 못했습니다. 잠시 뒤 다시 시도해 주세요.',
  unexpected: 'Flow가 요청을 처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요.',
  'save-failed': '키를 이 PC에 저장하지 못했습니다. 다시 시도해 주세요.',
};

/** 키를 고치지 않고 [다시 시도]로 다시 해 볼 만한 실패. 키가 맞지 않으면 키를 고쳐야 하므로 넣지 않는다. */
const RETRYABLE_FAILURES: ReadonlySet<FlowKeyCheckFailure> = new Set(['network', 'rate-limited', 'unexpected', 'save-failed']);

/** "Flow 계정" 칸에 넘기는 값. */
interface FlowAccountSectionProps {
  /** "Flow 계정" 칸의 상태. */
  flowAccount: FlowAccountSnapshot;
  /** "키 확인 필요" 전역 문제가 있는지 여부. 연결된 계정이 있어도 키를 다시 넣어야 한다. */
  keyNeedsCheck: boolean;
}

/**
 * 설정 "Flow 계정" 칸. 연결된 계정 카드와 개인 API 키 입력을 보인다.
 * 키는 [확인]으로 Flow에 확인되었을 때만 main이 저장하므로 저장 버튼은 없다.
 */
export function FlowAccountSection({ flowAccount, keyNeedsCheck }: FlowAccountSectionProps) {
  /** 연결된 계정과 키 확인의 진행 상태. */
  const { account, keyCheck } = flowAccount;
  /** 연결된 계정이 있을 때 [키 바꾸기]로 입력 칸을 연 상태. */
  const [editing, setEditing] = useState(false);
  /** 입력 칸의 키. 확인에 성공하면 비운다. */
  const [apiKey, setApiKey] = useState('');
  /** 이 창에서 시작한 마지막 확인의 실패 이유. */
  const [failure, setFailure] = useState<FlowKeyCheckFailure | null>(null);
  /** 키 입력 칸. */
  const inputRef = useRef<HTMLInputElement>(null);
  /** 앞 렌더의 확인 진행 상태. 확인 시트가 닫힌 순간을 알아내는 데 쓴다. */
  const previousStatus = useRef(keyCheck.status);

  useEffect(function followKeyCheckResults() {
    return window.stardraft.onEvent((event) => {
      if (event.type !== 'flow-key-check-finished') return;
      if (event.result === 'connected') {
        setEditing(false);
        setApiKey('');
        setFailure(null);
      } else {
        setFailure(event.result);
      }
    });
  }, []);

  useEffect(
    function refocusInputAfterSwitchCancelled() {
      // 다른 계정으로 바꾸기를 취소해 시트가 닫히면 키를 고칠 수 있게 입력 칸으로 초점을 돌려준다.
      if (previousStatus.current === 'awaiting-confirmation' && keyCheck.status === 'idle') inputRef.current?.focus();
      previousStatus.current = keyCheck.status;
    },
    [keyCheck.status],
  );

  /** 확인이나 저장이 진행 중이라 입력을 막는지 여부. 요청 한도로 기다리는 동안에는 바로 다시 확인할 수 있게 열어 둔다. */
  const busy = keyCheck.status === 'checking' || keyCheck.status === 'awaiting-confirmation';

  /** 입력한 키로 확인을 시작한다. [다시 시도]도 같은 키로 이 경로를 탄다. */
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || apiKey.trim() === '') return;
    setFailure(null);
    window.stardraft.send({ type: 'check-flow-key', apiKey }).catch(() => setFailure('unexpected'));
  };

  /** 연결된 계정의 키를 바꾸려고 입력 칸을 연다. */
  const handleEdit = () => {
    setEditing(true);
    setFailure(null);
  };

  /** 키 바꾸기를 그만두고 계정 카드로 돌아간다. 기다리던 다시 확인도 그만둔다. */
  const handleCancel = () => {
    setEditing(false);
    setApiKey('');
    setFailure(null);
    void window.stardraft.send({ type: 'cancel-flow-key-check' });
  };

  return (
    <>
      <p className="section-lead muted">멘션을 감지하고 내 이름으로 댓글을 올리는 데 쓰는 개인 API 키입니다.</p>
      {account && !editing ? (
        <AccountCard account={account} keyNeedsCheck={keyNeedsCheck} onEdit={handleEdit} />
      ) : (
        <form className="field" onSubmit={handleSubmit}>
          <label className="field-label" htmlFor="flow-api-key">
            개인 API 키
          </label>
          <p className="field-help muted">
            Flow 웹의 <strong>내 API 키</strong>에서 발급합니다. 메뉴가 보이지 않으면 회사 관리자가 개인 키 발급을 허용해야 합니다.
          </p>
          <div className="row">
            <input
              ref={inputRef}
              id="flow-api-key"
              className="text-input key-input"
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="키를 붙여 넣으세요"
              maxLength={FLOW_API_KEY_MAX_LENGTH}
              autoComplete="off"
              spellCheck={false}
              autoFocus
              disabled={busy}
            />
            {account && (
              <button type="button" className="btn" onClick={handleCancel}>
                취소
              </button>
            )}
            <button type="submit" className="btn primary" disabled={busy || apiKey.trim() === ''}>
              {busy ? '확인 중…' : '확인'}
            </button>
          </div>
          {keyCheck.status === 'waiting-retry' && (
            <p className="field-note muted" role="status">
              Flow 요청이 많아 잠시 뒤 다시 확인합니다.
            </p>
          )}
          {failure && (
            <p className="field-error" role="alert">
              {FAILURE_MESSAGES[failure]}
              {RETRYABLE_FAILURES.has(failure) && (
                <>
                  {' '}
                  <button type="submit" className="btn link" disabled={busy}>
                    다시 시도
                  </button>
                </>
              )}
            </p>
          )}
        </form>
      )}
    </>
  );
}

/** 계정 카드에 넘기는 값. */
interface AccountCardProps {
  /** 연결된 계정. */
  account: FlowAccountProfile;
  /** "키 확인 필요"인지 여부. 이때는 "연결됨" 대신 키를 다시 넣으라고 보인다. */
  keyNeedsCheck: boolean;
  /** [키 바꾸기]나 [키 다시 입력]을 눌렀을 때. */
  onEdit: () => void;
}

/** 연결된 계정의 이름, 소속, 이메일과 "연결됨"(키 확인이 필요하면 "키 확인 필요")을 보이는 카드. */
function AccountCard({ account, keyNeedsCheck, onEdit }: AccountCardProps) {
  return (
    <div className="field">
      <span className="field-label">연결된 계정</span>
      <div className="account-card">
        <span className="account-avatar" aria-hidden="true">
          {Array.from(account.name)[0] ?? ''}
        </span>
        <div className="account-info">
          <div className="account-name">
            <strong>{account.name}</strong>
            {account.division && ` · ${account.division}`}
          </div>
          <div className="muted small">{account.email}</div>
        </div>
        {keyNeedsCheck ? (
          <span className="danger-text small">키 확인 필요</span>
        ) : (
          <span className="ok-text small">✓ 연결됨</span>
        )}
        <button type="button" className="btn sm" onClick={onEdit}>
          {keyNeedsCheck ? '키 다시 입력' : '키 바꾸기'}
        </button>
      </div>
      <p className="field-note muted">키는 이 PC에만 암호화해 보관합니다.</p>
    </div>
  );
}
