import { getContainerRenderer } from '@astrojs/react/container-renderer';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { beforeAll, describe, expect, it } from 'vitest';
import Page from './pages/index.astro';

/** 빌드한 페이지 HTML(JS가 돌기 전 모습). */
let html = '';

/** 태그를 지우고 공백을 하나로 줄인 글. 글 사이의 태그(굵게, 링크, 코드)는 띄우지 않고 지운다. */
function textOf(fragment: string): string {
  return fragment
    .replace(/<\/?(?:b|a|code)(?: [^>]*)?>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** 섹션 하나의 HTML. */
function section(id: string): string {
  return html.match(new RegExp(`<section id="${id}"[^>]*>([\\s\\S]*?)</section>`))?.[1] ?? '';
}

beforeAll(async () => {
  const container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
  html = await container.renderToString(Page);
});

describe('다운로드 사이트 페이지', () => {
  it('섹션과 목차가 다운로드 → 설치 전에 필요한 것 → 설치 안내 → 업데이트 → 변경 내역 → 이전 버전과 SHA256 → 삭제 순서다', () => {
    const order = ['download', 'prerequisites', 'install', 'update', 'changelog', 'versions', 'uninstall'];

    expect([...html.matchAll(/<section id="([a-z]+)"/g)].map(([, id]) => id)).toEqual(order);
    expect([...html.matchAll(/data-toc="([a-z]+)"/g)].map(([, id]) => id)).toEqual(order);
  });

  it('JS가 돌기 전에는 두 OS 버튼이 모두 보이고, 첫 화면 맨 아래에 서명하지 않은 이유와 받을 주소 안내가 있다', () => {
    const download = section('download');

    expect(download).toContain('href="/download/mac"');
    expect(download).toContain('href="/download/windows"');
    expect(textOf(download)).toContain('유료 인증서로 서명하지 않은 오픈소스 앱이라, 설치할 때 macOS와 Windows가 경고를 띄웁니다. 이 주소에서 받은 파일만 설치하세요.');
  });

  it('업데이트 섹션은 스펙 문구 그대로다', () => {
    const text = textOf(section('update'));

    for (const sentence of [
      'Stardraft는 새 버전을 스스로 확인하고 받아 둡니다. 준비되면 트레이 메뉴와 Stardraft 창에 다시 시작이 나타나고, 누르면 새 버전으로 다시 켜집니다.',
      "Mac: 다시 켜지면 macOS가 'Stardraft Safe Storage' 사용을 묻습니다. Mac 로그인 암호를 넣고 항상 허용을 누르세요. 관리자 권한을 주는 창이 아닙니다. 허용만 누르면 다음에 또 묻습니다.",
      '앱이 스스로 업데이트하지 못할 때: 이 페이지에서 새 버전을 받아 덮어 설치하세요. 데이터는 그대로 남습니다. Mac은 그래도 열기와 키체인 확인을, Windows는 SmartScreen 확인을 다시 거칩니다.',
      'Windows에서 앱이 사라졌거나 켜지지 않을 때: 이 페이지에서 다시 설치하세요. 데이터는 그대로입니다.',
    ]) {
      expect(text).toContain(sentence);
    }
  });

  it('설치 전에 필요한 것은 Flow 개인 API 키와 Claude Code 설치·로그인이다', () => {
    const text = textOf(section('prerequisites'));

    expect(text).toContain('Flow 개인 API 키');
    expect(text).toContain('Claude Code 설치와 로그인');
    expect(text).toContain('claude auth login');
  });

  it('변경 내역과 이전 버전은 GitHub Release 목록으로 링크하고 다운그레이드 차단을 안내한다', () => {
    const releases = 'href="https://github.com/example-owner/stardraft/releases"';

    expect(section('changelog')).toContain(releases);
    expect(section('versions')).toContain(releases);
    expect(textOf(section('versions'))).toContain('새 버전이 만든 데이터가 있으면, Stardraft는 켜지지 않고 새 버전을 다시 설치하라고 알립니다');
  });

  it('삭제는 OS별 단계와 데이터 폴더 경로, 키체인 항목을 안내한다', () => {
    const text = textOf(section('uninstall'));

    expect(text).toContain('~/Library/Application Support/Stardraft/');
    expect(text).toContain('%APPDATA%\\Stardraft\\');
    expect(text).toContain('Stardraft Safe Storage');
  });

  it('한국어 문서이고 검색 노출을 막지 않는다', () => {
    expect(html).toContain('<html lang="ko"');
    expect(html).not.toMatch(/noindex|nofollow/i);
  });
});
