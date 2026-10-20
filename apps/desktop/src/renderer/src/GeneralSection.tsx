import type { AppFolder, AppSnapshot } from '../../shared/ipc';

/** "일반" 칸에 넘기는 값. */
interface GeneralSectionProps {
  /** 앱 상태 스냅숏. 받기 전에는 `null`이다. */
  snapshot: AppSnapshot | null;
}

/** 설정 "일반" 칸. 로그인 시 자동 시작, 데이터 폴더·로그 폴더 열기와 버전을 보인다. 바꾸는 설정은 즉시 저장하므로 저장 버튼은 없다. */
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
