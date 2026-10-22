import type { InstallerOs } from '../lib/releases';

/** 앱 아이콘의 별 모양. 색은 감싼 요소의 글자색(CSS)을 따른다. */
function Star({ size, className }: { size: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 1.8l2.5 7.2 7.3 3-7.3 3L12 22.2 9.5 15 2.2 12l7.3-3z" fill="currentColor" />
    </svg>
  );
}

/** 설치하면 아이콘이 생기는 자리(macOS 메뉴 막대, Windows 트레이) 그림. 별 반짝임은 장식 모션이다. */
export function TrayArt({ os }: { os: InstallerOs }) {
  /** 메뉴 막대나 작업 표시줄의 별 아이콘과 반짝임. */
  const star = (
    <span className="ha-star">
      <span className="ring" />
      <Star size={22} className="main" />
      <i className="spk k1">
        <Star size={10} />
      </i>
      <i className="spk k2">
        <Star size={8} />
      </i>
      {os === 'mac' && (
        <>
          <i className="spk k3">
            <Star size={9} />
          </i>
          <i className="spk k4">
            <Star size={7} />
          </i>
        </>
      )}
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
      <figcaption className="ha-cap">설치를 마치면 {os === 'windows' ? '트레이' : '메뉴 막대'}에 이 별 아이콘이 생깁니다.</figcaption>
    </figure>
  );
}
