import type { AppSnapshot } from '../../shared/ipc';
import { TrialButton, TrialPickerSheet } from './TrialPicker';

/** "초안" 칸에 넘기는 값. */
interface DraftsSectionProps {
  /** 앱 상태 스냅숏. */
  snapshot: AppSnapshot;
}

/** 설정 "초안" 칸. 지금은 [최근 멘션으로 시험]만 있다. */
export function DraftsSection({ snapshot }: DraftsSectionProps) {
  /** 시험 상태. */
  const { trial } = snapshot;

  return (
    <div className="field">
      <span className="field-label">최근 멘션으로 시험</span>
      <p className="field-help muted">지난 멘션 하나를 골라 실제와 똑같이 초안을 만들어 봅니다. Flow에는 아무것도 올라가지 않습니다.</p>
      <TrialButton trial={trial} window="settings" />
      {!snapshot.onboarding.detectionStarted && <p className="field-note muted">멘션 감지를 시작한 뒤에 쓸 수 있습니다.</p>}
      {trial.bundleId !== null && <p className="field-note muted">시험 중인 묶음이 있습니다. 시험을 끝내면 다시 시험할 수 있습니다.</p>}
      {trial.picker?.window === 'settings' && <TrialPickerSheet picker={trial.picker} />}
    </div>
  );
}
