import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { TrayIcon } from './TrayArt';

it('설치 안내의 트레이 문양은 실제 앱의 대기 아이콘과 같다', () => {
  /** 앱이 배포하는 트레이 원본의 경로. */
  const source = readFileSync(new URL('../../../desktop/resources/tray/idle.svg', import.meta.url), 'utf8');
  /** 안내에 렌더링된 문양. */
  const markup = renderToStaticMarkup(<TrayIcon size={22} />);
  expect(markup).toContain(source.match(/d="([^"]+)"/)![1]);
});
