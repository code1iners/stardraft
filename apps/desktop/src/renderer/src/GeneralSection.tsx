import { useState, type KeyboardEvent } from 'react';
import type { AppFolder, AppSnapshot, EditorSnapshot } from '../../shared/ipc';

/** 선택 상자에서 "처음 열 때 고르기"의 값. */
const UNCHOSEN_VALUE = '';
/** 선택 상자에서 "직접 지정"의 값. */
const COMMAND_VALUE = 'command';
/** 선택 상자에서 찾은 에디터의 값 앞에 붙는 말. 뒤에 에디터 ID가 온다. */
const APP_VALUE_PREFIX = 'app:';

/** OS마다 직접 지정 칸에 보일 명령 예. 셸 없이 실행하므로 전체 경로를 쓴다. */
const COMMAND_EXAMPLES: Record<AppSnapshot['platform'], string> = {
  darwin: '/usr/local/bin/code --goto "{file}:{line}"',
  win32: '"C:\\Program Files\\Sublime Text\\subl.exe" "{file}:{line}"',
  other: '/usr/bin/code --goto "{file}:{line}"',
};

/** "일반" 칸에 넘기는 값. */
interface GeneralSectionProps {
  /** 앱 상태 스냅숏. 받기 전에는 `null`이다. */
  snapshot: AppSnapshot | null;
}

/** 에디터 칸에 넘기는 값. */
interface EditorFieldProps {
  /** 기억한 에디터와 찾은 에디터. */
  editor: EditorSnapshot;
  /** 실행 중인 OS. 명령 예를 OS에 맞춘다. */
  platform: AppSnapshot['platform'];
}

/**
 * 근거의 "에디터에서 열기"에 쓸 에디터. 처음 열 때 고르기, 이 PC에서 찾은 에디터, "직접 지정" 가운데 고른다.
 * 직접 지정은 `{file}`, `{line}` 자리를 넣은 명령 한 줄이고, 칸을 벗어나거나 Enter를 칠 때 저장한다. 읽을 수 없는 명령은 main이 저장하지 않는다.
 */
export function EditorField({ editor, platform }: EditorFieldProps) {
  /** 기억한 에디터와 이 PC에서 찾은 에디터. */
  const { choice, installed } = editor;
  /** 저장한 명령. 직접 지정하지 않았으면 빈 문자열이다. */
  const savedCommand = choice?.kind === 'command' ? choice.command : '';
  /** "직접 지정"을 골랐지만 아직 명령을 저장하지 않았는지 여부. */
  const [commandPending, setCommandPending] = useState(false);
  // 저장한 뒤 새 스냅숏을 받기 전에 칸이 옛 값으로 돌아가지 않게, 마지막으로 친 명령을 따로 둔다.
  /** 마지막으로 친 명령. 치지 않았으면 `null`. */
  const [typed, setTyped] = useState<string | null>(null);
  /** 명령 칸의 글. */
  const command = typed ?? savedCommand;
  /** 선택 상자의 값. */
  const selected = commandPending || choice?.kind === 'command' ? COMMAND_VALUE : choice ? `${APP_VALUE_PREFIX}${choice.appId}` : UNCHOSEN_VALUE;
  /** 기억한 에디터가 이 PC에서 사라졌는지 여부. 사라졌으면 다음에 열 때 다시 고르게 된다. */
  const missingApp = choice?.kind === 'app' && !installed.some((item) => item.appId === choice.appId) ? choice.appId : null;

  /** 선택 상자에서 골랐다. "직접 지정"은 명령을 저장할 때까지 기다린다. */
  const handleSelect = (value: string) => {
    if (value === COMMAND_VALUE) {
      setCommandPending(true);
      return;
    }
    setCommandPending(false);
    setTyped(null);
    void window.stardraft.send({
      type: 'set-editor',
      choice: value === UNCHOSEN_VALUE ? null : { kind: 'app', appId: value.slice(APP_VALUE_PREFIX.length) },
    });
  };
  /** 친 명령을 저장한다. 비었거나 그대로면 보내지 않는다. */
  const handleSave = () => {
    if (command.trim() === '' || command === savedCommand) return;
    void window.stardraft.send({ type: 'set-editor', choice: { kind: 'command', command } });
  };
  /** Enter를 치면 저장한다. */
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') handleSave();
  };

  return (
    <div className="field">
      <label className="field-label" htmlFor="editor-select">
        에디터
      </label>
      <p className="field-help muted">근거의 "에디터에서 열기"에 씁니다. 찾은 에디터로는 근거의 그 줄을 엽니다.</p>
      <select id="editor-select" className="text-input model-select" value={selected} onChange={(event) => handleSelect(event.target.value)}>
        <option value={UNCHOSEN_VALUE}>처음 열 때 고르기</option>
        {installed.map((item) => (
          <option key={item.appId} value={`${APP_VALUE_PREFIX}${item.appId}`}>
            {item.name}
          </option>
        ))}
        {missingApp && <option value={`${APP_VALUE_PREFIX}${missingApp}`}>{missingApp} (찾을 수 없음)</option>}
        <option value={COMMAND_VALUE}>직접 지정</option>
      </select>
      {installed.length === 0 && <p className="field-note muted">찾은 에디터가 없어 OS 기본 앱으로 파일만 엽니다.</p>}
      {selected === COMMAND_VALUE && (
        <>
          <input
            className="text-input editor-command"
            aria-label="에디터 명령"
            placeholder={COMMAND_EXAMPLES[platform]}
            value={command}
            onChange={(event) => setTyped(event.target.value)}
            onBlur={handleSave}
            onKeyDown={handleKeyDown}
          />
          <p className="field-note muted">
            {'{file}'} 자리에 파일 경로, {'{line}'} 자리에 줄 번호가 들어갑니다. 셸 없이 실행하므로 명령은 전체 경로로 적습니다.
            {savedCommand !== '' && command === savedCommand && ' 저장됨'}
          </p>
          {command.trim() !== '' && !(command.includes('{file}') && command.includes('{line}')) && (
            <p className="field-note danger-text">명령에 {'{file}'}과 {'{line}'} 자리가 있어야 저장됩니다.</p>
          )}
        </>
      )}
    </div>
  );
}

/** OS마다 알림이 보이지 않을 때 확인할 곳. */
const NOTIFICATION_SETTINGS_HINT: Record<AppSnapshot['platform'], string> = {
  darwin: '시스템 설정 > 알림',
  win32: '설정 > 시스템 > 알림',
  other: 'OS의 알림 설정',
};

/** 알림 칸에 넘기는 값. */
interface NotificationFieldProps {
  /** 화면에 보일 앱 이름. OS 알림 설정에 이 이름으로 보인다. */
  appName: string;
  /** 실행 중인 OS. 알림 설정의 위치를 OS에 맞춘다. */
  platform: AppSnapshot['platform'];
}

/** [알림 시험]. 시험 알림을 하나 띄우고, 보이지 않으면 OS 알림 설정을 확인하게 안내한다. */
export function NotificationField({ appName, platform }: NotificationFieldProps) {
  return (
    <div className="field">
      <span className="field-label">알림</span>
      <p className="field-help muted">초안이 준비되거나 확인할 일이 생기면 OS 알림으로 알려 드립니다.</p>
      <button type="button" className="btn" onClick={() => void window.stardraft.send({ type: 'test-notification' })}>
        알림 시험
      </button>
      <p className="field-note muted">
        알림이 보이지 않으면 {NOTIFICATION_SETTINGS_HINT[platform]}에서 {appName}의 알림을 허용해 주세요.
      </p>
    </div>
  );
}

/**
 * 설정 "일반" 칸. 로그인 시 자동 시작, 알림 시험, 에디터, 데이터 폴더·로그 폴더 열기와 버전을 보인다.
 * 바꾸는 설정은 즉시 저장하므로 저장 버튼은 없다.
 */
export function GeneralSection({ snapshot }: GeneralSectionProps) {
  /** 폴더를 OS 파일 관리자로 연다. 경로는 main이 정한다. */
  const handleOpenFolder = (folder: AppFolder) => {
    void window.stardraft.send({ type: 'open-folder', folder });
  };

  return (
    <>
      {snapshot && (
        <fieldset className="field plain-fieldset">
          <legend className="field-label">시작</legend>
          <label className="choice-row">
            <input
              type="checkbox"
              checked={snapshot.launchAtLogin}
              onChange={(event) => void window.stardraft.send({ type: 'set-launch-at-login', enabled: event.target.checked })}
            />
            로그인할 때 {snapshot.appName} 자동으로 켜기
          </label>
          <p className="field-note muted">앱이 켜져 있어야 멘션을 감지합니다.</p>
        </fieldset>
      )}
      {snapshot && <NotificationField appName={snapshot.appName} platform={snapshot.platform} />}
      {snapshot && <EditorField editor={snapshot.editor} platform={snapshot.platform} />}
      <div className="field">
        <span className="field-label">데이터</span>
        <div className="row">
          <button type="button" className="btn" onClick={() => handleOpenFolder('data')}>
            데이터 폴더 열기
          </button>
          <button type="button" className="btn" onClick={() => handleOpenFolder('logs')}>
            로그 폴더 열기
          </button>
        </div>
        {snapshot && (
          <p className="field-note muted">
            {snapshot.appName} {snapshot.version}
          </p>
        )}
      </div>
    </>
  );
}
