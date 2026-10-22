import { formatReleaseDate } from '../lib/format';
import { useReleases, type ReleasesState } from './use-releases';

/** 변경 내역이 받는 것. */
type Props = {
  /** GitHub Release 목록 주소. */
  releaseListUrl: string;
};

/** 최근 공개 Release의 버전·날짜·릴리스 노트. 받는 상태를 받아 그리기만 한다. */
export function ChangelogList({ state, releaseListUrl }: Props & { state: ReleasesState }) {
  return (
    <>
      {state.status === 'loading' && <p className="muted">변경 내역을 불러오는 중입니다.</p>}
      {state.status === 'failed' && <p className="muted">변경 내역을 불러오지 못했습니다. 아래 GitHub 목록에서 보세요.</p>}
      {state.status === 'ready' && state.releases.length === 0 && <p className="muted">아직 공개된 버전이 없습니다.</p>}
      {state.status === 'ready' && state.releases.length > 0 && (
        <ol className="changes">
          {state.releases.map((release) => (
            <li key={release.version}>
              <div className="ch-h">
                <b>v{release.version}</b>
                <span className="muted small">{formatReleaseDate(release.date)}</span>
              </div>
              {/* 릴리스 노트는 Release를 공개하는 저장소 주인이 쓴 마크다운이지만 HTML로 풀지 않고 글 그대로 보인다. */}
              {release.notes.trim() && <p className="notes">{release.notes.trim()}</p>}
            </li>
          ))}
        </ol>
      )}
      <p className="small">
        <a className="link" href={releaseListUrl}>
          전체 변경 내역 (GitHub)
        </a>
      </p>
    </>
  );
}

/** 변경 내역 섹션의 본문. 최근 3개를 보인다. */
export function Changelog({ releaseListUrl }: Props) {
  return <ChangelogList state={useReleases()} releaseListUrl={releaseListUrl} />;
}
