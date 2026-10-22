import type { AppCommand, UpdateStateSnapshot } from '../../shared/ipc';
import { restartConfirmTitle } from '../../shared/update-text';
import { updateBannerView, type UpdateBannerButton } from './update-text';

/** 띠의 버튼마다 이름과 보낼 명령. 사이트 주소는 main이 정한다. 띠 닫기는 띠 이름을 실어야 해서 따로 만든다. */
const BANNER_BUTTONS: Record<Exclude<UpdateBannerButton, 'dismiss'>, { label: string; command: AppCommand }> = {
  restart: { label: '다시 시작', command: { type: 'restart-to-update' } },
  changelog: { label: '변경 내역', command: { type: 'open-site', section: 'changelog' } },
  'restart-now': { label: '지금 다시 시작', command: { type: 'restart-update-now' } },
  'cancel-restart': { label: '취소', command: { type: 'cancel-update-restart' } },
  'open-site': { label: '사이트에서 받기', command: { type: 'open-site', section: 'update' } },
  'retry-install': { label: '다시 시도', command: { type: 'retry-update-install' } },
};

/** 업데이트 띠에 넘기는 값. */
interface UpdateBannerProps {
  /** 앱 내 업데이트의 화면 상태. */
  update: UpdateStateSnapshot;
}

/** 작은 창 맨 위 띠 자리의 업데이트 띠. 전역 문제 띠가 없을 때만 그린다. 둘 띠가 없으면 아무것도 그리지 않는다. */
export function UpdateBanner({ update }: UpdateBannerProps) {
  /** 띠의 문구와 버튼. */
  const view = updateBannerView(update);
  if (!view) return null;

  /** 버튼을 누르면 보낼 명령. */
  const commandOf = (button: UpdateBannerButton): AppCommand =>
    button === 'dismiss' ? { type: 'dismiss-update-banner', banner: view.id } : BANNER_BUTTONS[button].command;

  return (
    <div className={view.danger ? 'update-banner danger' : 'update-banner'} role="status">
      <p>{view.text}</p>
      {view.buttons.map((button) => (
        <button key={button} type="button" className="btn sm" onClick={() => void window.stardraft.send(commandOf(button))}>
          {button === 'dismiss' ? '닫기' : BANNER_BUTTONS[button].label}
        </button>
      ))}
    </div>
  );
}

/** 다시 시작 확인 화면에 넘기는 값. */
interface RestartConfirmProps {
  /** 다시 시작해 설치할 새 버전. */
  version: string;
  /** 화면에 보일 앱 이름. 키체인 항목 이름이 "앱 이름 Safe Storage"다. */
  appName: string;
}

/**
 * macOS 다시 시작 확인 화면. 다시 켜지면 macOS가 키체인 항목 사용을 묻는다는 안내와, 그 대화상자를 재현한 예시 화면을 보인다.
 * 업데이트할 때마다 보이고 "다시 보지 않기"는 없다.
 */
export function RestartConfirm({ version, appName }: RestartConfirmProps) {
  /** 키체인 항목 이름. */
  const keychainItem = `${appName} Safe Storage`;

  return (
    <>
      <main className="popover-body restart-confirm">
        <h2 className="restart-title">{restartConfirmTitle(version)}</h2>
        <p>
          다시 켜지면 macOS가 '{keychainItem}' 사용을 묻습니다. Mac 로그인 암호를 넣고 '항상 허용'을 누르세요. 관리자 권한을 주는 창이
          아닙니다. '허용'만 누르면 다음에 또 묻습니다.
        </p>
        <figure className="example">
          <figcaption className="example-label">예시 화면 · 실제 창이 아닙니다</figcaption>
          <div className="example-frame">
            <div className="keychain-dialog" aria-hidden="true">
              <p className="keychain-text">
                {appName}이(가) 사용자의 키체인에 있는 기밀 정보 '{keychainItem}'을(를) 사용하려고 합니다.
              </p>
              <p className="keychain-text">허용하려면 '로그인' 키체인 암호를 입력하십시오.</p>
              <div className="keychain-field">
                <span>암호:</span>
                <span className="keychain-input" />
              </div>
              <div className="keychain-buttons">
                <span className="keychain-btn emphasized">항상 허용</span>
                <span className="keychain-btn">거부</span>
                <span className="keychain-btn">허용</span>
              </div>
            </div>
          </div>
        </figure>
      </main>
      <footer className="popover-foot restart-foot">
        <button type="button" className="btn primary" onClick={() => void window.stardraft.send({ type: 'confirm-update-restart' })}>
          다시 시작
        </button>
        <button type="button" className="btn" onClick={() => void window.stardraft.send({ type: 'cancel-update-restart-confirm' })}>
          나중에
        </button>
      </footer>
    </>
  );
}
