import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AppSnapshot, EditorSnapshot } from '../../shared/ipc';
import { EditorField, NotificationField } from './GeneralSection';

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
