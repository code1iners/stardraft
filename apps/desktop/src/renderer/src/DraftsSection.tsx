import { useState, type KeyboardEvent } from 'react';
import { EXTRA_INSTRUCTIONS_MAX_LENGTH, SECRET_PATTERN_MAX_LENGTH, type AppSnapshot, type DraftSettingsSnapshot } from '../../shared/ipc';
import { TrialButton, TrialPickerSheet } from './TrialPicker';

/** "초안" 칸에 넘기는 값. */
interface DraftsSectionProps {
  /** 앱 상태 스냅숏. */
  snapshot: AppSnapshot;
}

/** 추가 지침 칸과 비밀 파일 패턴 칸에 넘기는 값. */
interface DraftSettingsFieldProps {
  /** 저장된 추가 지침과 비밀 파일 패턴. */
  draftSettings: DraftSettingsSnapshot;
}

/**
 * 추가하려는 비밀 파일 패턴을 받을 수 없는 까닭. 받을 수 있거나 비어 있으면 `null`.
 * main도 같은 규칙으로 다시 보고, 여기서는 누르기 전에 알리려고 본다.
 */
export function secretPatternProblem(input: string, draftSettings: DraftSettingsSnapshot): string | null {
  /** 앞뒤 공백을 뗀 패턴. */
  const pattern = input.trim();
  if (pattern === '') return null;
  // eslint-disable-next-line no-control-regex
  if (pattern.length > SECRET_PATTERN_MAX_LENGTH || pattern.startsWith('!') || /["\\()\u0000-\u001f\u007f]/.test(pattern)) {
    return '따옴표, 괄호, 역슬래시는 쓸 수 없고 !로 시작할 수 없습니다.';
  }
  /** 견줄 패턴. 판정이 대소문자를 가리지 않으므로 비교도 가리지 않는다. */
  const lower = pattern.toLowerCase();
  if ([...draftSettings.defaultSecretPatterns, ...draftSettings.extraSecretPatterns].some((item) => item.toLowerCase() === lower)) {
    return '이미 있는 패턴입니다.';
  }
  return null;
}

/** 모든 초안에 적용할 추가 지침. 여러 줄 입력이라 칸을 벗어날 때 저장하고 "저장됨"을 표시한다. */
export function ExtraInstructionsField({ draftSettings }: DraftSettingsFieldProps) {
  /** 저장된 추가 지침. */
  const saved = draftSettings.extraInstructions;
  // 저장한 뒤 새 스냅숏을 받기 전에 칸이 옛 값으로 돌아가지 않게, 마지막으로 친 지침을 따로 둔다.
  /** 마지막으로 친 지침. 치지 않았으면 `null`. */
  const [typed, setTyped] = useState<string | null>(null);
  /** 칸의 글. */
  const text = typed ?? saved;

  /** 칸을 벗어나면 친 지침을 저장한다. 그대로면 보내지 않는다. */
  const handleBlur = () => {
    if (typed === null || typed === saved) return;
    void window.stardraft.send({ type: 'set-extra-instructions', text: typed });
  };

  return (
    <div className="field">
      <label className="field-label" htmlFor="extra-instructions">
        추가 지침
      </label>
      <p className="field-help muted">
        모든 초안에 기본 지침 뒤에 붙습니다. 어조, 길이, 호칭, 맺음말을 바꿀 수 있고, 결과 형식과 쉬운 말 기준은 바뀌지 않습니다.
      </p>
      <textarea
        id="extra-instructions"
        className="text-input instructions-input"
        placeholder={'예: 맺음말로 "확인 부탁드립니다"를 붙입니다.'}
        maxLength={EXTRA_INSTRUCTIONS_MAX_LENGTH}
        value={text}
        onChange={(event) => setTyped(event.target.value)}
        onBlur={handleBlur}
      />
      <p className="field-note muted">
        칸을 벗어나면 저장하고 다음 실행부터 씁니다. 이미 만든 초안은 다시 만들지 않습니다.
        {typed !== null && typed === saved && ' 저장됨'}
      </p>
    </div>
  );
}

/** 비밀 파일 패턴. 기본 목록은 읽기 전용이고, 그 아래에 패턴을 추가만 할 수 있다. 추가한 패턴은 모든 저장소에 적용한다. */
export function SecretPatternsField({ draftSettings }: DraftSettingsFieldProps) {
  /** 추가할 패턴 칸의 글. */
  const [input, setInput] = useState('');
  /** 칸의 패턴을 받을 수 없는 까닭. */
  const problem = secretPatternProblem(input, draftSettings);
  /** [추가]를 누를 수 있는지 여부. */
  const canAdd = input.trim() !== '' && problem === null;

  /** 칸의 패턴을 추가하고 칸을 비운다. */
  const handleAdd = () => {
    if (!canAdd) return;
    void window.stardraft.send({ type: 'add-secret-pattern', pattern: input });
    setInput('');
  };
  /** Enter를 치면 추가한다. */
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') handleAdd();
  };

  return (
    <div className="field">
      <span className="field-label">비밀 파일 패턴</span>
      <p className="field-help muted">이 패턴에 맞는 파일은 에이전트가 읽지 못하고, 근거로 들면 결과를 버립니다. 모든 저장소에 적용됩니다.</p>
      <p className="pattern-heading muted">기본 패턴</p>
      <ul className="pattern-list" aria-label="기본 패턴">
        {draftSettings.defaultSecretPatterns.map((pattern) => (
          <li key={pattern}>{pattern}</li>
        ))}
      </ul>
      {draftSettings.extraSecretPatterns.length > 0 && (
        <>
          <p className="pattern-heading muted">추가한 패턴</p>
          <ul className="pattern-list" aria-label="추가한 패턴">
            {draftSettings.extraSecretPatterns.map((pattern) => (
              <li key={pattern}>{pattern}</li>
            ))}
          </ul>
        </>
      )}
      <div className="row">
        <input
          className="text-input pattern-input"
          aria-label="추가할 패턴"
          placeholder="예: *.vault.yml"
          maxLength={SECRET_PATTERN_MAX_LENGTH}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button type="button" className="btn" disabled={!canAdd} onClick={handleAdd}>
          추가
        </button>
      </div>
      {problem && <p className="field-error">{problem}</p>}
      <p className="field-note muted">
        추가한 패턴은 지울 수 없습니다. 추가하면 만들고 있는 초안은 새 패턴으로 처음부터 다시 만들고, 게시하지 않은 초안의 근거를 다시 검사해 걸린 초안은 버립니다.
      </p>
    </div>
  );
}

/** 설정 "초안" 칸. 추가 지침, 비밀 파일 패턴, [최근 멘션으로 시험] 순서다. */
export function DraftsSection({ snapshot }: DraftsSectionProps) {
  /** 시험 상태. */
  const { trial } = snapshot;

  return (
    <>
      <ExtraInstructionsField draftSettings={snapshot.draftSettings} />
      <SecretPatternsField draftSettings={snapshot.draftSettings} />
      <div className="field">
        <span className="field-label">최근 멘션으로 시험</span>
        <p className="field-help muted">지난 멘션 하나를 골라 실제와 똑같이 초안을 만들어 봅니다. Flow에는 아무것도 올라가지 않습니다.</p>
        <TrialButton trial={trial} window="settings" />
        {!snapshot.onboarding.detectionStarted && <p className="field-note muted">멘션 감지를 시작한 뒤에 쓸 수 있습니다.</p>}
        {trial.bundleId !== null && <p className="field-note muted">시험 중인 묶음이 있습니다. 시험을 끝내면 다시 시험할 수 있습니다.</p>}
        {trial.picker?.window === 'settings' && <TrialPickerSheet picker={trial.picker} />}
      </div>
    </>
  );
}
