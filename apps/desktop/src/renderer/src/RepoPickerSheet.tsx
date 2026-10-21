import type { KeyboardEvent } from 'react';
import type { BundleSnapshot, RepoChoiceGroupSnapshot, RepoChoiceSnapshot, RepoPickerSnapshot } from '../../shared/ipc';
import { LINKED_NOTE, linkButtonText, REPO_CHOICE_GROUP_LABELS } from './review-text';

/** 후보 무리를 보이는 순서. */
const GROUP_ORDER: readonly RepoChoiceGroupSnapshot[] = ['current', 'work-folder', 'mapping', 'added'];

/** 저장소 선택 창에 넘기는 값. */
interface RepoPickerSheetProps {
  /** 열린 저장소 선택 창. */
  picker: RepoPickerSnapshot;
  /** 창을 연 묶음. 만들기 버튼 문구를 정한다. 목록에 없으면 `null`. */
  bundle: BundleSnapshot | null;
}

/**
 * 저장소 선택 창. "저장소를 골라 만들기"와 "다른 저장소로 다시 만들기"가 같이 쓰는 시트로, 창 위쪽에 붙어 창 전체를 덮는다.
 * 후보를 무리별로 체크 상자와 함께 보이고, 고른 구성으로 초안을 만들거나 저장소 매핑을 덮어쓴다. 체크 상태는 main이 가진다.
 */
export function RepoPickerSheet({ picker, bundle }: RepoPickerSheetProps) {
  /** 고른 후보. */
  const checked = picker.status === 'ready' ? picker.choices.filter((choice) => choice.checked) : [];
  /** 만들기 버튼 문구. 초안이 있던 묶음이면 다시 만드는 것이다. */
  const generateLabel = bundle?.status === 'ready' ? '이 저장소로 다시 만들기' : '이 저장소로 만들기';

  /** 창을 닫는다. */
  const handleClose = () => {
    void window.stardraft.send({ type: 'close-repo-picker' });
  };

  /** Esc는 [닫기]와 같다. */
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') handleClose();
  };

  /** 폴더 선택 창으로 후보에 없는 폴더를 더한다. */
  const handlePickFolders = () => {
    void window.stardraft.send({ type: 'pick-repo-picker-folders' });
  };

  /** 고른 구성으로 저장소 매핑을 덮어쓴다. */
  const handleLink = () => {
    void window.stardraft.send({ type: 'link-repo-picker' });
  };

  /** 고른 구성으로 초안을 만든다. main이 창을 닫는다. */
  const handleGenerate = () => {
    void window.stardraft.send({ type: 'generate-with-repo-picker' });
  };

  return (
    <div className="sheet-backdrop">
      <div className="sheet repo-picker" role="dialog" aria-modal="true" aria-labelledby="repo-picker-title" onKeyDown={handleKeyDown}>
        <h3 id="repo-picker-title">저장소 고르기</h3>
        <p className="muted small">고른 저장소를 읽어 초안을 만듭니다. 여러 개를 고를 수 있고, 위에 있는 저장소부터 읽습니다.</p>
        {picker.status === 'loading' ? (
          <p className="muted">작업 폴더에서 저장소를 찾는 중입니다.</p>
        ) : (
          <div className="repo-choices">
            {GROUP_ORDER.map((group) => (
              <RepoChoiceGroup key={group} group={group} choices={picker.choices.filter((choice) => choice.group === group)} />
            ))}
            {picker.choices.length === 0 && <p className="muted small">후보가 없습니다. 폴더를 직접 고르세요.</p>}
          </div>
        )}
        <button type="button" className="btn sm" disabled={picker.status !== 'ready'} onClick={handlePickFolders}>
          폴더 직접 고르기
        </button>
        {picker.status === 'ready' && picker.mapping === 'same' && <p className="muted small">{LINKED_NOTE}</p>}
        <div className="sheet-actions">
          <span className="small muted repo-picker-count">{checked.length}개 고름</span>
          <button type="button" className="btn" onClick={handleClose}>
            닫기
          </button>
          <button
            type="button"
            className="btn"
            disabled={picker.status !== 'ready' || checked.length === 0 || picker.mapping === 'same'}
            onClick={handleLink}
          >
            {linkButtonText(picker.status === 'ready' ? picker.mapping : 'unmapped')}
          </button>
          <button type="button" className="btn primary" disabled={checked.length === 0} onClick={handleGenerate}>
            {generateLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 후보 무리에 넘기는 값. */
interface RepoChoiceGroupProps {
  /** 무리. */
  group: RepoChoiceGroupSnapshot;
  /** 무리에 든 후보. 비어 있으면 무리를 그리지 않는다. */
  choices: RepoChoiceSnapshot[];
}

/** 후보 무리 하나. 머리말 아래에 후보마다 체크 상자, 이름, 경로를 둔다. */
function RepoChoiceGroup({ group, choices }: RepoChoiceGroupProps) {
  if (choices.length === 0) return null;
  return (
    <fieldset className="repo-choice-group">
      <legend className="small muted">{REPO_CHOICE_GROUP_LABELS[group]}</legend>
      {choices.map((choice) => (
        <label key={choice.path} className="repo-choice">
          <input
            type="checkbox"
            checked={choice.checked}
            onChange={(event) => void window.stardraft.send({ type: 'set-repo-picker-checked', path: choice.path, checked: event.target.checked })}
          />
          <span>
            <strong>{choice.name}</strong>
            <span className="small muted">{choice.path}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
