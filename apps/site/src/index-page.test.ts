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
    .replace(/<\/?(?:b|a|code|q)(?: [^>]*)?>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 설치 안내 탭 패널 하나의 단계(<li>)마다 HTML. */
function installSteps(os: 'mac' | 'windows'): string[] {
  const panel = html.match(new RegExp(`id="install-panel-${os}"[^>]*>([\\s\\S]*?)</ol>`))?.[1] ?? '';
  return panel.split('<li>').slice(1);
}

/** 단계의 제목. */
function titleOf(step: string): string {
  return textOf(step.match(/<h3>([\s\S]*?)<\/h3>/)?.[1] ?? '');
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

  it('설치 안내는 OS 탭과 macOS 5단계·Windows 4단계이고, JS가 돌기 전에는 macOS 탭이 열려 있다', () => {
    const install = section('install');

    expect(install).toMatch(/role="tablist"/);
    expect(install).toMatch(/id="install-tab-mac"[^>]*aria-selected="true"/);
    expect(install).toMatch(/id="install-tab-windows"[^>]*aria-selected="false"/);
    expect(install).toMatch(/id="install-panel-windows"[^>]*hidden/);
    expect(installSteps('mac').map(titleOf)).toEqual([
      'DMG를 열고 응용 프로그램 폴더로 옮기기',
      '처음 열면 뜨는 창에서 완료 누르기',
      '시스템 설정에서 그래도 열기 누르기',
      '한 번 더 확인하고 암호 입력하기',
      '메뉴 막대에 아이콘이 보이면 끝',
    ]);
    expect(installSteps('windows').map(titleOf)).toEqual([
      '스마트 앱 컨트롤 확인하기 (Windows 11)',
      '설치 파일을 열고 추가 정보 → 실행',
      '묻는 것 없이 설치되고 켜집니다',
      '트레이에 아이콘이 보이면 끝',
    ]);
  });

  it('단계마다 제목, 화면 문구, 지시, 단계 안의 예시 화면 틀, 완료 기준이 있다', () => {
    for (const step of [...installSteps('mac'), ...installSteps('windows')]) {
      const title = titleOf(step);

      expect(textOf(step), title).toMatch(/이 문구가 보이면: \S/);
      expect(step, title).toMatch(/<figure class="example">[\s\S]*예시 화면 · 눌러 볼 수 있지만 실제 창이 아닙니다/);
      expect(step, title).toMatch(/<p class="check">/);
    }
  });

  it('누를 버튼 이름은 굵게 쓰고, macOS 1단계에 ~/Applications 한 줄이 있다', () => {
    const [first, second] = installSteps('mac');

    expect(textOf(first!)).toContain('관리자가 아닌 계정이면 홈 폴더의 응용 프로그램 폴더(~/Applications)에 두세요.');
    expect(second).toContain('<b>완료</b>를 눌러 닫으세요');
    expect(installSteps('windows')[1]).toContain('<b>추가 정보</b>를 누르면');
  });

  it('스마트 앱 컨트롤 단계는 상태별 표이고 Windows 10은 건너뛴다', () => {
    const sac = installSteps('windows')[0]!;
    const rows = [...sac.matchAll(/<tr><td><b>([^<]+)<\/b><\/td><td>([^<]+)<\/td><\/tr>/g)].map(([, state, action]) => [state, action]);

    expect(rows).toEqual([
      ['평가', '다음 단계로 갑니다.'],
      ['끄기', '다음 단계로 갑니다.'],
      ['켜기', '스마트 앱 컨트롤이 켜져 있으면 Stardraft는 실행되지 않습니다.'],
    ]);
    expect(textOf(sac)).toContain('Windows 10에는 이 설정이 없으니 다음 단계로 바로 가세요.');
  });

  it('"여기서 막히면"은 열 항목이고 손상됨은 스펙 문구 그대로다', () => {
    /** 단계마다 "여기서 막히면"의 질문. */
    const questions = (os: 'mac' | 'windows') =>
      installSteps(os).map((step) => [...step.matchAll(/<dt>([\s\S]*?)<\/dt>/g)].map(([, question]) => textOf(question!)));

    expect(questions('mac')).toEqual([
      [],
      ['“손상되었기 때문에 열 수 없습니다”라고 떠요', '휴지통으로 이동을 눌렀어요', 'Intel Mac에서 열리지 않아요'],
      ['그래도 열기 버튼이 안 보여요'],
      [],
      ['메뉴 막대에 아이콘이 안 보여요', '알림 허용을 놓쳤어요'],
    ]);
    expect(questions('windows')).toEqual([
      [],
      ['실행 버튼이 없어요', '스마트 앱 컨트롤이 앱을 차단했다는 창이 떠요'],
      ['“Stardraft이(가) 실행 중입니다. OK을 클릭하면 종료됩니다.” 창이 떠요'],
      ['트레이에 아이콘이 안 보여요'],
    ]);

    const text = textOf(section('install'));
    expect(text).toContain('받는 중에 파일이 깨졌거나 바뀌었을 수 있습니다. 이 파일은 지우고 사이트에서 다시 받으세요. 다시 받아도 같으면 설치하지 마세요.');
    expect(text).toContain('약 1시간 동안만 보입니다');
    expect(text).toContain('노치');
    expect(text).toContain('^');
  });

  it('설치 안내에 넣지 않는 것: xattr, 연락 절차, 스마트 앱 컨트롤을 끄라는 안내, 우클릭 > 열기', () => {
    const text = textOf(section('install'));

    expect(text).not.toMatch(/xattr/);
    expect(text).not.toMatch(/담당자|문의하|연락하|연락 주|알려 주세요|알려 달라/);
    expect(text).not.toMatch(/스마트 앱 컨트롤[^.]*(끄세요|끄고|꺼 주세요|끄면)/);
    expect(text).not.toMatch(/우클릭|오른쪽 클릭|Control.?클릭/);
  });

  it('업데이트 섹션의 키체인 예시 화면은 앱의 다시 시작 확인 화면처럼 "항상 허용"을 강조한다', () => {
    const update = section('update');

    expect(update).toContain('예시 화면 · 실제 창이 아닙니다');
    expect(textOf(update)).toContain("Stardraft이(가) 사용자의 키체인에 있는 기밀 정보 'Stardraft Safe Storage'을(를) 사용하려고 합니다.");
    expect(update).toMatch(/class="keychain-btn emphasized"[^>]*>항상 허용</);
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
