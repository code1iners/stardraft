import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ReleaseSummary } from '../lib/releases';
import { ChangelogList } from './Changelog';
import { CurrentFilesView } from './CurrentFiles';

/** 가짜 Release 하나. */
function release(version: string, notes = ''): ReleaseSummary {
  return {
    version,
    date: '2026-11-10T03:00:00Z',
    notes,
    url: `https://github.com/example-owner/stardraft/releases/tag/v${version}`,
    files: [
      { os: 'mac', name: `Stardraft-${version}-arm64.dmg`, size: 121_000_000, sha256: 'a'.repeat(64) },
      { os: 'windows', name: `Stardraft-Setup-${version}.exe`, size: 98_000_000, sha256: 'c'.repeat(64) },
    ],
  };
}

/** GitHub Release 목록 주소. */
const LIST_URL = 'https://github.com/example-owner/stardraft/releases';

describe('변경 내역', () => {
  it('받은 Release의 버전·날짜·릴리스 노트를 글 그대로 보이고 GitHub 전체 목록으로 링크한다', () => {
    const html = renderToStaticMarkup(
      <ChangelogList state={{ status: 'ready', releases: [release('0.3.0', '- <b>굵게</b> 고쳤습니다.'), release('0.2.1'), release('0.2.0')] }} releaseListUrl={LIST_URL} />,
    );

    expect([...html.matchAll(/<b>v([\d.]+)<\/b>/g)].map(([, version]) => version)).toEqual(['0.3.0', '0.2.1', '0.2.0']);
    expect(html).toContain('2026년 11월 10일');
    expect(html).toContain('- &lt;b&gt;굵게&lt;/b&gt; 고쳤습니다.');
    expect(html).toContain(`href="${LIST_URL}"`);
  });

  it('받지 못해도 GitHub 목록 링크는 남는다', () => {
    const html = renderToStaticMarkup(<ChangelogList state={{ status: 'failed' }} releaseListUrl={LIST_URL} />);

    expect(html).toContain('불러오지 못했습니다');
    expect(html).toContain(`href="${LIST_URL}"`);
  });
});

describe('지금 버전의 파일 표', () => {
  it('파일마다 버전을 고정한 받기 주소·크기·SHA256 복사와 OS별 확인 명령을 보인다', () => {
    const html = renderToStaticMarkup(<CurrentFilesView state={{ status: 'ready', releases: [release('0.2.0')] }} />);

    expect(html).toContain('href="/download/0.2.0/mac"');
    expect(html).toContain('href="/download/0.2.0/windows"');
    expect(html).toContain('121 MB');
    expect(html).toContain('shasum -a 256 ~/Downloads/Stardraft-0.2.0-arm64.dmg');
    expect(html).toContain('Get-FileHash &quot;$env:USERPROFILE\\Downloads\\Stardraft-Setup-0.2.0.exe&quot;');
  });
});
