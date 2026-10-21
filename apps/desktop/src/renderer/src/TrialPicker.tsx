import type { KeyboardEvent } from 'react';
import type { TrialCandidateSnapshot, TrialLoadFailureSnapshot, TrialPickerSnapshot, TrialSnapshot, TrialWindowSnapshot } from '../../shared/ipc';
import { formatMentionTime } from './review-text';

/** 최근 멘션을 불러오지 못한 까닭의 쉬운 말. */
const LOAD_FAILURE_TEXT: Record<TrialLoadFailureSnapshot, string> = {
  'no-key': 'Flow 개인 API 키가 없어 최근 멘션을 불러오지 못했습니다.',
  unauthorized: 'Flow가 키를 받지 않아 최근 멘션을 불러오지 못했습니다. 설정 "Flow 계정"에서 키를 확인하세요.',
  network: 'Flow에 연결하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 불러오세요.',
  'rate-limited': 'Flow 요청이 많습니다. 잠시 뒤에 다시 불러오세요.',
  unexpected: '최근 멘션을 불러오지 못했습니다.',
};

/** [최근 멘션으로 시험] 버튼에 넘기는 값. */
interface TrialButtonProps {
  /** 시험 상태. */
  trial: TrialSnapshot;
  /** 멘션 고르기 목록을 열 창. */
  window: TrialWindowSnapshot;
}

/** [최근 멘션으로 시험]. 감지를 시작했고 시험 묶음이 없을 때만 누를 수 있다. 누르면 이 창에 멘션 고르기 목록을 연다. */
export function TrialButton({ trial, window: trialWindow }: TrialButtonProps) {
  /** 멘션 고르기 목록을 연다. */
  const handleOpen = () => {
    void window.stardraft.send({ type: 'open-trial-picker', window: trialWindow });
  };

  return (
    <button type="button" className="btn" disabled={!trial.canStart} onClick={handleOpen}>
      최근 멘션으로 시험
    </button>
  );
}

/** 멘션 고르기 목록에 넘기는 값. */
interface TrialPickerSheetProps {
  /** 열린 멘션 고르기 목록. */
  picker: TrialPickerSnapshot;
}

/**
 * 멘션 고르기 목록. 최근 멘션 10건을 송신자, Flow 프로젝트, 첫 줄, 시각으로 보이고 하나를 고르면 시험을 시작한다.
 * 자동으로 고르지 않는다. 이미 답한 멘션에는 "답함"을 붙이지만 고를 수 있다.
 */
export function TrialPickerSheet({ picker }: TrialPickerSheetProps) {
  /** 목록을 닫는다. */
  const handleClose = () => {
    void window.stardraft.send({ type: 'close-trial-picker' });
  };

  /** Esc는 [닫기]와 같다. */
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') handleClose();
  };

  /** 최근 멘션을 다시 불러온다. */
  const handleReload = () => {
    void window.stardraft.send({ type: 'reload-trial-picker' });
  };

  return (
    <div className="sheet-backdrop">
      <div className="sheet trial-picker" role="dialog" aria-modal="true" aria-labelledby="trial-picker-title" onKeyDown={handleKeyDown}>
        <h3 id="trial-picker-title">시험할 멘션 고르기</h3>
        <p className="muted small">고른 멘션으로 실제와 똑같이 초안을 만듭니다. Flow에는 아무것도 올라가지 않습니다.</p>
        {picker.status === 'loading' && <p className="muted">최근 멘션을 불러오는 중입니다.</p>}
        {picker.status === 'failed' && <p className="field-error">{LOAD_FAILURE_TEXT[picker.reason]}</p>}
        {picker.status === 'loaded' &&
          (picker.candidates.length > 0 ? (
            <ul className="trial-choices">
              {picker.candidates.map((candidate) => (
                <TrialChoice key={candidate.alarmId} candidate={candidate} />
              ))}
            </ul>
          ) : (
            <p className="muted">시험할 수 있는 최근 멘션이 없습니다.</p>
          ))}
        <div className="sheet-actions">
          {picker.status !== 'loading' && (
            <button type="button" className="btn" onClick={handleReload}>
              다시 불러오기
            </button>
          )}
          <button type="button" className="btn" onClick={handleClose}>
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}

/** 멘션 고르기 목록의 한 줄에 넘기는 값. */
interface TrialChoiceProps {
  /** 보일 멘션. */
  candidate: TrialCandidateSnapshot;
}

/** 멘션 고르기 목록의 한 줄. 누르면 그 멘션으로 시험을 시작한다. */
function TrialChoice({ candidate }: TrialChoiceProps) {
  /** 이 멘션으로 시험을 시작한다. main이 목록을 닫는다. */
  const handleStart = () => {
    void window.stardraft.send({ type: 'start-trial', alarmId: candidate.alarmId });
  };

  return (
    <li>
      <button type="button" className="trial-choice" onClick={handleStart}>
        <span className="list-row-top">
          <strong>{candidate.senderName || '이름 없음'}</strong>
          {candidate.answered && <span className="tag done">답함</span>}
          <span className="spacer" />
          <span className="small muted">{formatMentionTime(candidate.at)}</span>
        </span>
        <span className="small muted">{candidate.projectTitle ?? '프로젝트 이름 모름'}</span>
        <span className="list-row-sub">{candidate.firstLine}</span>
      </button>
    </li>
  );
}
