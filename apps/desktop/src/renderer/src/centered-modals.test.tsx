import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AccountSwitchModal } from './AccountSwitchModal';
import { EditorPickerModal } from './EditorPickerModal';
import { RepoPickerModal } from './RepoPickerModal';

/** 가짜 계정. 실제 사람이 아니다. */
const ACCOUNT = { name: '가상 사용자', division: '', email: 'user@example.test' };

/** 세 확인 창의 렌더링 결과. */
const MODALS = {
  '계정 바꾸기': renderToStaticMarkup(<AccountSwitchModal account={ACCOUNT} />),
  '저장소 선택': renderToStaticMarkup(<RepoPickerModal picker={{ bundleId: 1, choices: [], mapping: 'unmapped' }} bundles={[]} />),
  '에디터 선택': renderToStaticMarkup(<EditorPickerModal picker={{ editors: [{ appId: 'a', name: '가상 에디터' }] }} />),
};

describe('화면 가운데 모달', () => {
  it.each(Object.entries(MODALS))('%s 창은 모달 배경 안의 모달 대화상자로 그려진다', (_name, html) => {
    expect(html).toContain('class="modal-backdrop"');
    expect(html).toMatch(/class="modal[ "][^>]*role="(alert)?dialog"|role="(alert)?dialog"[^>]*class="modal/);
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('modal-actions');
    expect(html).not.toMatch(/sheet/);
  });

  it('계정 바꾸기는 [취소], [지우고 바꾸기] 순서다', () => {
    const html = MODALS['계정 바꾸기'];
    expect(html.indexOf('취소')).toBeLessThan(html.indexOf('지우고 바꾸기'));
  });
});
