import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ReleaseSummary } from '../lib/releases';
import type { Visitor } from '../lib/visitor';
import { DownloadPanel } from './DownloadPanel';

/** 가짜 최신 Release. */
const LATEST: ReleaseSummary = {
  version: '0.2.0',
  date: '2026-11-10T03:00:00Z',
  notes: '',
  url: 'https://github.com/example-owner/stardraft/releases/tag/v0.2.0',
  files: [
    { os: 'mac', name: 'Stardraft-0.2.0-arm64.dmg', size: 121_000_000, sha256: 'a'.repeat(64) },
    { os: 'windows', name: 'Stardraft-Setup-0.2.0.exe', size: 98_000_000, sha256: 'c'.repeat(64) },
  ],
};

/** 첫 화면을 그려 링크·버튼과 글을 꺼낸다. */
function render(visitor: Visitor | null, latest: ReleaseSummary | null = LATEST) {
  const html = renderToStaticMarkup(<DownloadPanel visitor={visitor} latest={latest} />);
  /** 다운로드 링크(글, 주소, 대표 버튼 여부). */
  const links = [...html.matchAll(/<a class="([^"]*)" href="(\/download\/[^"]+)"[^>]*>([^<]+)<\/a>/g)].map(([, cls, href, label]) => ({
    label,
    href,
    primary: cls!.includes('primary'),
  }));
  /** 태그를 지운 글. */
  const text = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
  return { html, links, text };
}

describe('첫 화면의 다운로드 버튼', () => {
  it('JS가 돌기 전(감지 전)에는 두 OS 버튼을 모두 보인다', () => {
    const { links, text } = render(null, null);

    expect(links).toEqual([
      { label: 'macOS용 다운로드', href: '/download/mac', primary: false },
      { label: 'Windows용 다운로드', href: '/download/windows', primary: false },
    ]);
    expect(text).toContain('Apple Silicon Mac · macOS 13 이상');
    expect(text).toContain('Windows 10 이상 · x64');
  });

  it('Apple Silicon Mac: macOS 대표 버튼, 지원 환경과 파일 크기, Windows용 받기, 버전·날짜와 SHA256 복사', () => {
    const { links, text, html } = render('mac-arm');

    expect(links).toEqual([
      { label: 'macOS용 다운로드', href: '/download/mac', primary: true },
      { label: 'Windows용 받기', href: '/download/windows', primary: false },
    ]);
    expect(text).toContain('Apple Silicon Mac · macOS 13 이상 · 121 MB');
    expect(text).toContain('v0.2.0 · 2026년 11월 10일');
    expect(html).toContain('href="#changelog"');
    expect(text).toContain('SHA256 복사');
    expect(text).not.toContain('이 Mac에 관하여');
  });

  it('칩을 알 수 없는 Mac: macOS 대표 버튼 밑에 칩 확인 방법', () => {
    const { links, text } = render('mac-unknown');

    expect(links[0]).toEqual({ label: 'macOS용 다운로드', href: '/download/mac', primary: true });
    expect(text).toContain('Apple 메뉴 > 이 Mac에 관하여');
    expect(text).toContain('‘칩’이 보이면 Apple Silicon');
    expect(text).toContain('‘프로세서’가 보이면 Intel Mac');
  });

  it('Intel Mac: 지원하지 않는다고 알리고 대표 버튼 대신 그래도 macOS용 받기와 Windows용 받기', () => {
    const { links, text } = render('mac-intel');

    expect(text).toContain('Apple Silicon Mac에서만 실행됩니다');
    expect(links).toEqual([
      { label: '그래도 macOS용 받기', href: '/download/mac', primary: false },
      { label: 'Windows용 받기', href: '/download/windows', primary: false },
    ]);
  });

  it('Windows: Windows 대표 버튼과 파일 크기, macOS용 받기', () => {
    const { links, text } = render('windows');

    expect(links).toEqual([
      { label: 'Windows용 다운로드', href: '/download/windows', primary: true },
      { label: 'macOS용 받기', href: '/download/mac', primary: false },
    ]);
    expect(text).toContain('Windows 10 이상 · x64 · 98 MB');
    expect(text).not.toContain('에뮬레이션');
  });

  it('Windows ARM: Windows 대표 버튼에 에뮬레이션 한 줄', () => {
    const { links, text } = render('windows-arm');

    expect(links[0]).toEqual({ label: 'Windows용 다운로드', href: '/download/windows', primary: true });
    expect(text).toContain('x64 에뮬레이션으로 실행됩니다');
  });

  it('휴대폰: 받기 대신 PC에서 열 링크 복사', () => {
    const { links, text } = render('mobile');

    expect(links).toEqual([]);
    expect(text).toContain('PC에서 열 링크 복사');
    expect(text).not.toContain('SHA256 복사');
  });

  it('그 밖의 OS: 이 OS용은 없다고 알리고 두 OS 버튼을 모두 보인다', () => {
    const { links, text } = render('other');

    expect(text).toContain('Mac과 Windows만 지원합니다');
    expect(links.map((link) => link.href)).toEqual(['/download/mac', '/download/windows']);
  });

  it('Release 정보를 아직 못 받았으면 크기와 버전 없이 버튼만 보인다', () => {
    const { links, text } = render('mac-arm', null);

    expect(links[0]).toEqual({ label: 'macOS용 다운로드', href: '/download/mac', primary: true });
    expect(text).toContain('Apple Silicon Mac · macOS 13 이상');
    expect(text).not.toContain('MB');
    expect(text).not.toContain('SHA256 복사');
  });
});
