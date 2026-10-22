import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AppSnapshot, EditorSnapshot, UpdateSnapshot } from '../../shared/ipc';
import { EditorField, NotificationField, UpdateField } from './GeneralSection';

/** 이 PC에서 찾은 가짜 에디터. */
const INSTALLED: EditorSnapshot['installed'] = [
  { appId: 'vscode', name: 'VS Code' },
  { appId: 'jetbrains:WebStorm', name: 'WebStorm' },
];

/** 에디터 칸을 그린 HTML. */
function htmlOf(editor: EditorSnapshot, platform: AppSnapshot['platform'] = 'darwin'): string {
  return renderToStaticMarkup(<EditorField editor={editor} platform={platform} />);
}

describe('설정 "일반"의 에디터', () => {
  it('아직 고르지 않았으면 "처음 열 때 고르기"를 고른 채로 찾은 에디터와 "직접 지정"을 보인다', () => {
    /** 그린 HTML. */
    const html = htmlOf({ choice: null, installed: INSTALLED, picker: null });

    expect(html).toMatch(/<option value="" selected="">처음 열 때 고르기<\/option>/);
    expect(html).toContain('<option value="app:vscode">VS Code</option>');
    expect(html).toContain('<option value="app:jetbrains:WebStorm">WebStorm</option>');
    expect(html).toContain('<option value="command">직접 지정</option>');
    expect(html).not.toContain('{file}');
  });

  it('고른 에디터가 이 PC에서 사라졌으면 "찾을 수 없음"을 붙여 남긴다', () => {
    expect(htmlOf({ choice: { kind: 'app', appId: 'cursor' }, installed: INSTALLED, picker: null })).toMatch(
      /<option value="app:cursor" selected="">cursor \(찾을 수 없음\)<\/option>/,
    );
  });

  it('직접 지정했으면 {file}·{line} 자리를 넣은 명령 한 줄 칸에 저장한 명령을 보이고 "저장됨"을 표시한다', () => {
    /** 그린 HTML. */
    const html = htmlOf({ choice: { kind: 'command', command: '/usr/local/bin/subl {file}:{line}' }, installed: INSTALLED, picker: null });

    expect(html).toMatch(/<option value="command" selected="">직접 지정<\/option>/);
    expect(html).toContain('value="/usr/local/bin/subl {file}:{line}"');
    expect(html).toContain('{file}');
    expect(html).toContain('저장됨');
  });

  it('찾은 에디터가 없으면 OS 기본 앱으로 파일만 연다고 알린다', () => {
    expect(htmlOf({ choice: null, installed: [], picker: null })).toContain('찾은 에디터가 없어 OS 기본 앱으로 파일만 엽니다.');
  });
});

describe('설정 "일반"의 알림 시험', () => {
  it('[알림 시험]과 함께 알림이 보이지 않을 때 OS마다 확인할 알림 설정을 앱 이름으로 안내한다', () => {
    /** macOS에서 그린 HTML. */
    const mac = renderToStaticMarkup(<NotificationField appName="Stardraft" platform="darwin" />);
    /** Windows에서 그린 HTML. */
    const windows = renderToStaticMarkup(<NotificationField appName="Stardraft Dev" platform="win32" />);

    expect(mac).toContain('<button type="button" class="btn">알림 시험</button>');
    expect(mac).toContain('시스템 설정 &gt; 알림에서 Stardraft의 알림을 허용해 주세요.');
    expect(windows).toContain('설정 &gt; 시스템 &gt; 알림에서 Stardraft Dev의 알림을 허용해 주세요.');
  });
});

/** 업데이트 칸을 그린 HTML. */
function updateHtmlOf(update: UpdateSnapshot | null): string {
  return renderToStaticMarkup(<UpdateField update={update} />);
}

describe('설정 "일반"의 업데이트', () => {
  it('최신 버전이거나 확인에 실패했으면 상태 문구와 [지금 확인]을 보인다', () => {
    /** 최신 버전일 때. */
    const upToDate = updateHtmlOf({ kind: 'up-to-date', checkedAt: Date.now() });
    /** 확인에 실패했을 때. */
    const failed = updateHtmlOf({ kind: 'check-failed', failedAt: Date.now() });

    expect(upToDate).toContain('최신 버전입니다 · 마지막 확인');
    expect(upToDate).toContain('>지금 확인</button>');
    expect(failed).toContain('마지막 확인 실패 · 방금');
    expect(failed).toContain('>지금 확인</button>');
  });

  it('확인 중에는 [지금 확인]을 보이지 않는다', () => {
    /** 확인 중일 때. */
    const html = updateHtmlOf({ kind: 'checking' });

    expect(html).toContain('확인 중…');
    expect(html).not.toContain('<button');
  });

  it('받는 중이면 받은 비율을 문구와 진행 막대로 보인다', () => {
    /** 받는 중일 때. */
    const html = updateHtmlOf({ kind: 'downloading', version: '0.2.0', percent: 45 });

    expect(html).toContain('0.2.0 받는 중… 45%');
    expect(html).toMatch(/<progress[^>]* max="100" value="45"/);
  });

  it('서명 검증에 실패했으면 실패 문구를 위험 색으로 보이고 [다시 시도]만 둔다', () => {
    /** 서명 검증에 실패했을 때. */
    const html = updateHtmlOf({ kind: 'signature-failed', version: '0.2.0' });

    expect(html).toMatch(/class="[^"]*danger-text[^"]*">업데이트 파일의 서명이 맞지 않아 설치하지 않았습니다\. 지금 버전을 계속 씁니다\./);
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain('>다시 시도</button>');
  });

  it('앱이 스스로 바꿀 수 없는 위치면 까닭과 [사이트에서 받기]만 보인다', () => {
    /** 읽기 전용 위치일 때. */
    const html = updateHtmlOf({ kind: 'location-blocked', version: '0.2.0', reason: 'read-only' });

    expect(html).toContain('새 버전 0.2.0 · 응용 프로그램 폴더로 옮긴 뒤 다시 여세요');
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain('>사이트에서 받기</button>');
  });

  it('소스에서 실행하면 업데이트를 확인하지 않는다고 알리고 버튼을 두지 않는다', () => {
    /** 업데이트를 끈 소스 실행일 때. */
    const html = updateHtmlOf(null);

    expect(html).toContain('개발 중 실행에서는 업데이트를 확인하지 않습니다.');
    expect(html).not.toContain('<button');
  });
});
