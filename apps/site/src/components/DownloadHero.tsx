import { useEffect, useState } from 'react';
import { readVisitor, visitorOs, type Visitor } from '../lib/visitor';
import { DownloadPanel } from './DownloadPanel';
import { TrayArt } from './TrayArt';
import { useReleases } from './use-releases';

/** 첫 화면의 다운로드 자리와 아이콘 자리 그림. 브라우저에서 방문 환경을 감지하고 최신 Release를 받는다. */
export function DownloadHero() {
  /** 감지한 방문 환경. 빌드한 HTML과 감지 전에는 null이라 두 OS 버튼이 보인다. */
  const [visitor, setVisitor] = useState<Visitor | null>(null);
  /** 최근 공개 Release. */
  const releases = useReleases();

  useEffect(function detectVisitorOnMount() {
    /** 화면을 떠난 뒤 늦게 끝난 감지를 버린다. */
    let active = true;
    readVisitor(navigator).then((detected) => active && setVisitor(detected));
    return () => {
      active = false;
    };
  }, []);

  /** 가장 최근 공개 Release. */
  const latest = releases.status === 'ready' ? (releases.releases[0] ?? null) : null;
  return (
    <div className="hero">
      <div>
        <h2>다운로드</h2>
        <DownloadPanel visitor={visitor} latest={latest} />
      </div>
      <TrayArt os={visitorOs(visitor) ?? 'mac'} />
    </div>
  );
}
