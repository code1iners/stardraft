import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ALLOWED_THINGS, ENV_FILE_UNSET_TEXT, SAVE_FAILURE_TEXT, baseName } from './reproduction-text';
import type { ReproductionSaveResult } from '../../shared/ipc';

/** 재현을 켜는 확인 모달에 넘기는 값. */
interface ReproductionConfirmModalProps {
  /** 재현을 켤 저장소의 절대 경로. */
  repoPath: string;
  /** 이미 지정해 둔 재현용 환경 파일. 없으면 `null`. */
  initialEnvFile: string | null;
  /** 모달을 닫는다. */
  onClose: () => void;
}

/**
 * 재현 허용을 켜는 순간 뜨는 화면 가운데 확인 모달. 허용되는 일, 재현용 환경 파일 고르기, 원본 `.env` 경고,
 * "운영 키를 넣지 마세요", MCP 인증 값 노출 안내를 한 화면에서 읽게 한다. [취소]하면 켜지지 않는다.
 * [켜기]를 누르면 main이 환경 파일을 확인해 저장하고 `reproduction-saved`로 알리며, 저장되면 닫힌다.
 */
export function ReproductionConfirmModal({ repoPath, initialEnvFile, onClose }: ReproductionConfirmModalProps) {
  /** 고른 환경 파일. 지정하지 않았으면 `null`. */
  const [envFile, setEnvFile] = useState<string | null>(initialEnvFile);
  /** 저장 요청을 보내고 결과를 기다리는 중인지 여부. */
  const [saving, setSaving] = useState(false);
  /** 마지막 저장의 실패 이유. */
  const [failure, setFailure] = useState<Exclude<ReproductionSaveResult, 'saved'> | null>(null);
  /** 처음 초점을 줄 [취소] 버튼. */
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(function focusCancelOnOpen() {
    cancelRef.current?.focus();
  }, []);

  useEffect(
    function followPickAndSaveResults() {
      return window.stardraft.onEvent((event) => {
        if (event.type === 'reproduction-env-file-picked') {
          setEnvFile(event.path);
          setFailure(null);
        } else if (event.type === 'reproduction-saved') {
          setSaving(false);
          if (event.result === 'saved') onClose();
          else setFailure(event.result);
        }
      });
    },
    [onClose],
  );

  /** 환경 파일과 함께 재현을 켠다. */
  const handleEnable = () => {
    setSaving(true);
    setFailure(null);
    window.stardraft.send({ type: 'set-reproduction-enabled', repoPath, enabled: true, envFile }).catch(() => {
      setSaving(false);
      setFailure('unsupported');
    });
  };

  /** Esc는 [취소]와 같다. */
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') onClose();
  };

  return (
    <div className="modal-backdrop">
      <div className="modal reproduction-modal" role="dialog" aria-modal="true" aria-labelledby="reproduction-title" onKeyDown={handleKeyDown}>
        <h3 id="reproduction-title">재현 허용 켜기</h3>
        <p className="muted" title={repoPath}>
          {baseName(repoPath)} 저장소의 오류를 내 PC에서 직접 따라 해 보게 합니다.
        </p>

        <div className="field">
          <span className="field-label">허용되는 일</span>
          <ul className="reproduction-list">
            {ALLOWED_THINGS.map((thing) => (
              <li key={thing}>{thing}</li>
            ))}
          </ul>
        </div>

        <div className="field">
          <span className="field-label">재현용 환경 파일</span>
          <p className="field-help muted">이 파일이 사본의 .env가 됩니다. 개발용 값만 담은 파일을 골라 주세요.</p>
          <div className="folder-row">
            {envFile === null ? (
              <span className="danger-text path-text">{ENV_FILE_UNSET_TEXT}</span>
            ) : (
              <span className="folder-path path-text" title={envFile}>
                {envFile}
              </span>
            )}
            <button type="button" className="btn sm" disabled={saving} onClick={() => void window.stardraft.send({ type: 'pick-reproduction-env-file-draft' })}>
              {envFile === null ? '파일 고르기…' : '바꾸기…'}
            </button>
          </div>
          {envFile === null && (
            <p className="danger-text small">지정하지 않으면 저장소의 원본 .env를 그대로 씁니다. 원본에 운영 키가 있다면 반드시 다른 파일을 고르세요.</p>
          )}
        </div>

        <p className="danger-text">운영 키를 넣지 마세요.</p>
        <p className="muted small">환경 파일의 값과 MCP 인증 값도 에이전트에게 노출될 수 있습니다. 막을 방법이 없어서 켜기 전에 알려 드립니다.</p>

        {failure !== null && (
          <p className="field-error" role="alert">
            {SAVE_FAILURE_TEXT[failure]}
          </p>
        )}

        <div className="modal-actions">
          <button type="button" className="btn" ref={cancelRef} disabled={saving} onClick={onClose}>
            취소
          </button>
          <button type="button" className="btn primary" disabled={saving} onClick={handleEnable}>
            켜기
          </button>
        </div>
      </div>
    </div>
  );
}
