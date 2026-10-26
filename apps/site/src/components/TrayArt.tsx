import traySource from '../../../desktop/resources/tray/idle.svg?raw';
import type { InstallerOs } from '../lib/releases';

/** 앱의 트레이 SVG 내부를 그대로 사용하되 색은 안내 화면의 글자색을 따른다. */
const trayContents = traySource.replace(/<svg[^>]*>/, '').replace('</svg>', '').trim();

/** 설치된 앱과 같은 대기 상태 트레이 문양. */
export function TrayIcon({ size, className }: { size: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: trayContents }}
    />
  );
}

/** 설치하면 아이콘이 생기는 자리(macOS 메뉴 막대, Windows 트레이) 그림. 실제 앱의 대기 상태 문양을 사용한다. */
export function TrayArt({ os }: { os: InstallerOs }) {
  /** 메뉴 막대나 작업 표시줄의 아이콘과 강조 표시. */
  const star = (
    <span className="ha-star">
      <span className="ring" />
      <TrayIcon size={22} className="main" />
    </span>
  );

  return (
    <figure className="hero-art" aria-hidden="true">
      <div className={os === 'windows' ? 'ha-screen win' : 'ha-screen'}>
        {os === 'windows' ? (
          <div className="ha-bar">
            <span className="ha-apps">
              <i className="ha-ico app on" />
              <i className="ha-ico app" />
              <i className="ha-ico app" />
            </span>
            <span className="r">
              {star}
              <span className="ha-clock">
                오후 3:12
                <br />
                2026-10-17
              </span>
            </span>
          </div>
        ) : (
          <div className="ha-bar">
            <b>Finder</b>
            <span className="hide-s">파일</span>
            <span className="hide-s">편집</span>
            <span className="hide-s">보기</span>
            <span className="r">
              <i className="ha-ico" />
              <i className="ha-ico hide-s" />
              {star}
              <span>금 오후 3:12</span>
            </span>
          </div>
        )}
        <span className="ha-label">설치하면 여기에 생깁니다</span>
      </div>
      <figcaption className="ha-cap">설치를 마치면 {os === 'windows' ? '트레이' : '메뉴 막대'}에 이 아이콘이 생깁니다.</figcaption>
    </figure>
  );
}
