import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { KeychainExample } from './KeychainExample';

/** 앱의 다시 시작 확인 화면 소스. 사이트는 앱 코드를 import하지 않고(사이트 빌드는 앱 폴더 변경을 보지 않음) 같은 대화상자를 따로 그린다. */
const appSource = readFileSync(new URL('../../../desktop/src/renderer/src/UpdatePrompts.tsx', import.meta.url), 'utf8');

/** 대화상자 부분의 줄 바꿈과 들여쓰기를 하나로 줄인 글. */
function squash(text: string): string {
  return text.replace(/\s+/g, ' ');
}

/** 키체인 대화상자의 글과 버튼(순서대로). 그린 HTML(class)과 앱 소스(className)를 함께 읽는다. */
function dialogOf(html: string) {
  return {
    texts: [...html.matchAll(/<p (?:class|className)="keychain-text">([^<]*)<\/p>/g)].map(([, text]) => text!.replace(/&#x27;/g, "'")),
    buttons: [...html.matchAll(/<span (?:class|className)="(keychain-btn[^"]*)">([^<]*)<\/span>/g)].map(([, cls, label]) => `${label}${cls!.includes('emphasized') ? '(강조)' : ''}`),
  };
}

describe('업데이트 섹션의 키체인 예시 화면', () => {
  it('앱의 다시 시작 확인 화면과 같은 문구·버튼 순서·강조를 쓴다', () => {
    const site = dialogOf(renderToStaticMarkup(<KeychainExample />));
    /** 앱 소스의 문구를 앱 이름 Stardraft로 채운 것. */
    const app = dialogOf(squash(appSource).replace(/> \{appName\}/g, '>Stardraft').replace(/'\{keychainItem\}'/g, "'Stardraft Safe Storage'").replace(/ <\/p>/g, '</p>'));

    expect(site.texts).toEqual([
      "Stardraft이(가) 사용자의 키체인에 있는 기밀 정보 'Stardraft Safe Storage'을(를) 사용하려고 합니다.",
      "허용하려면 '로그인' 키체인 암호를 입력하십시오.",
    ]);
    expect(site.buttons).toEqual(['항상 허용(강조)', '거부', '허용']);
    expect(app).toEqual(site);
  });
});
