import type { SiteSection } from '../shared/ipc';

/** 다운로드 사이트 주소. 앱은 사람이 읽는 페이지만 열고, 업데이트 파일은 GitHub Release에서 직접 받는다. */
const SITE_URL = 'https://stardraft.squadify.app/';

/** 섹션마다의 앵커(요소 id). 사이트는 한 페이지 문서라 섹션을 앵커로 연다. 사이트도 같은 id를 둔다. */
const SECTION_ANCHORS: Record<SiteSection, string> = {
  update: 'update',
};

/** 다운로드 사이트 섹션의 주소. */
export function siteSectionUrl(section: SiteSection): string {
  return `${SITE_URL}#${SECTION_ANCHORS[section]}`;
}
