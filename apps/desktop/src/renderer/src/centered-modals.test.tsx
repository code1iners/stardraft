import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AccountSwitchModal } from './AccountSwitchModal';
import { EditorPickerModal } from './EditorPickerModal';
import { RepoPickerModal } from './RepoPickerModal';

/** 새로 넣은 키의 가짜 계정. 실제 사람이 아니다. */
const ACCOUNT = { name: '가상 사용자', division: '', email: 'user@example.test' };
/** 지금 연결된 가짜 계정. 한 사람이 두 회사를 다녀 이름이 같다. */
const CURRENT = { name: '가상 사용자', division: '가짜 회사 개발팀', email: 'user@company.test' };

/** 세 확인 창의 렌더링 결과. */
const MODALS = {
  '계정 바꾸기': renderToStaticMarkup(<AccountSwitchModal account={ACCOUNT} current={CURRENT} stored={false} />),
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

  it('계정 바꾸기는 [취소], [계정 바꾸기] 순서다', () => {
    const html = MODALS['계정 바꾸기'];
    expect(html.indexOf('>취소<')).toBeLessThan(html.indexOf('>계정 바꾸기<'));
    expect(html).not.toContain('지우고');
  });
});

describe('계정 바꾸기 확인 창', () => {
  it('제목에 새 계정의 이름과 이메일을 함께 적는다', () => {
    const html = renderToStaticMarkup(<AccountSwitchModal account={ACCOUNT} current={CURRENT} stored={false} />);
    expect(html).toContain('가상 사용자(user@example.test) 계정의 키입니다');
  });

  it('처음 넣는 계정이면 지금 계정의 기록을 30일 보관하고 그 안에 돌아오면 이어 쓸 수 있다고 알린다', () => {
    const html = renderToStaticMarkup(<AccountSwitchModal account={ACCOUNT} current={CURRENT} stored={false} />);
    expect(html).toContain('지금 계정(가짜 회사 개발팀)의 기록은 30일 동안 보관합니다. 그 안에 돌아오면 이어서 쓸 수 있습니다.');
    expect(html).not.toContain('보관한 기록을 이어서 씁니다.');
    expect(html).toContain('만들던 초안과 게시 대기는 멈춥니다.');
  });

  it('보관해 둔 계정이면 보관한 기록을 이어서 쓴다고 먼저 알린다', () => {
    const html = renderToStaticMarkup(<AccountSwitchModal account={ACCOUNT} current={CURRENT} stored />);
    expect(html).toContain('보관한 기록을 이어서 씁니다. 지금 계정(가짜 회사 개발팀)의 기록은 30일 동안 보관합니다.');
    expect(html).not.toContain('그 안에 돌아오면');
    expect(html).toContain('만들던 초안과 게시 대기는 멈춥니다.');
  });
});
