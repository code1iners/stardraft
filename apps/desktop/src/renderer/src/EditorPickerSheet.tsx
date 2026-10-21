import type { KeyboardEvent } from 'react';
import type { EditorSnapshot } from '../../shared/ipc';

/** 에디터 고르기 창에 넘기는 값. */
interface EditorPickerSheetProps {
  /** 열린 에디터 고르기 창. */
  picker: NonNullable<EditorSnapshot['picker']>;
}

/**
 * 근거의 "에디터에서 열기"를 처음 누를 때 뜨는 시트. 이 PC에서 찾은 에디터를 보이고, 고르면 main이 기억하고 그 줄을 연다.
 * 고르지 않고 닫으면 아무것도 열지 않는다.
 */
export function EditorPickerSheet({ picker }: EditorPickerSheetProps) {
  /** 창을 닫는다. */
  const handleClose = () => {
    void window.stardraft.send({ type: 'close-editor-picker' });
  };

  /** Esc는 [닫기]와 같다. */
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') handleClose();
  };

  return (
    <div className="sheet-backdrop">
      <div className="sheet editor-picker" role="dialog" aria-modal="true" aria-labelledby="editor-picker-title" onKeyDown={handleKeyDown}>
        <h3 id="editor-picker-title">근거를 열 에디터 고르기</h3>
        <p className="muted small">고른 에디터로 근거의 그 줄을 엽니다. 다음부터는 바로 열고, 설정 "일반"에서 바꿀 수 있습니다.</p>
        <div className="editor-choices">
          {picker.editors.map((editor) => (
            <button
              key={editor.appId}
              type="button"
              className="btn"
              onClick={() => void window.stardraft.send({ type: 'choose-editor', appId: editor.appId })}
            >
              {editor.name}
            </button>
          ))}
        </div>
        <div className="sheet-actions">
          <button type="button" className="btn" onClick={handleClose}>
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
