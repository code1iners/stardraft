import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AppSnapshot, BundleSnapshot, ReviewSnapshot } from '../../shared/ipc';
import { PopoverContent } from './PopoverView';
import { ReviewContent } from './ReviewView';

/** 창마다 처음 영역 펼침 상태. */
const SECTIONS: ReviewSnapshot['sections'] = {
  compact: { original: true, repository: false },
  expanded: { original: true, repository: true },
};

/** 가짜 멘션 묶음. 실제 사람이나 글이 아니다. 기본은 멘션 두 건이 든 저장소 확인 필요 댓글 스레드 묶음이다. */
function bundle(id: number, overrides: Partial<BundleSnapshot> = {}): BundleSnapshot {
  return {
    id,
    status: 'repo-check-needed',
    group: 'awaiting-review',
    place: 'thread',
    projectTitle: '가짜 프로젝트',
    postTitle: `가짜 게시물 ${id}`,
    mentions: [
      {
        senderName: '보낸 사람',
        place: 'comment',
        at: Date.UTC(2026, 9, 19, 23, 50),
        text: [
          { text: '@테스트 사용자', mention: true },
          { text: ' 첫 질문입니다', mention: false },
        ],
      },
      {
        senderName: '다른 사람',
        place: 'reply',
        at: Date.UTC(2026, 9, 19, 23, 51),
        text: [{ text: '둘째 질문입니다', mention: false }],
      },
    ],
    senderNames: ['보낸 사람', '다른 사람'],
    newMentionCount: 0,
    lastMentionAt: Date.UTC(2026, 9, 19, 23, 51),
    processedAt: null,
    canRestore: false,
    canOpenInFlow: true,
    ...overrides,
  };
}

/** 이미 답함 묶음. */
const ANSWERED = bundle(3, {
  status: 'already-answered',
  group: 'processed',
  place: 'post',
  senderNames: ['세번째 사람'],
  mentions: [{ senderName: '세번째 사람', place: 'post', at: Date.UTC(2026, 9, 19, 23, 40), text: [{ text: '본문 질문', mention: false }] }],
  processedAt: Date.UTC(2026, 9, 20, 0, 0),
  canRestore: true,
});

/** 가짜 앱 상태 스냅숏. 감지를 시작한 뒤다. */
function snapshot(bundles: BundleSnapshot[], overrides: Partial<AppSnapshot> = {}): AppSnapshot {
  return {
    appName: 'Stardraft',
    version: '0.0.0-test',
    platform: 'darwin',
    flowAccount: { account: null, keyCheck: { status: 'idle' } },
    globalProblem: null,
    agentConnection: {
      progress: { status: 'connected' },
      details: {
        cliPath: null,
        cliCommand: 'claude',
        updateCommand: 'claude update',
        version: null,
        requiredVersion: '0.0.0',
        authMethod: null,
        pathSource: null,
        searchedDirs: [],
        errorOutput: null,
      },
    },
    agentPreferences: { connectedAgents: [], defaultAgent: null, models: {} },
    workFolders: { folders: [], suggestions: [], rejected: [] },
    repoMappings: { mappings: [], projects: { status: 'idle' } },
    onboarding: {
      detectionStarted: true,
      requirements: { 'flow-key': 'done', agent: 'done', 'work-folders': 'done' },
      ready: true,
      start: { status: 'idle' },
    },
    launchAtLogin: true,
    review: { bundles, sections: SECTIONS },
    ...overrides,
  };
}

/** 화면을 그린 HTML에서 태그를 지운 글자. 공백은 하나로 줄인다. */
function textOf(element: React.ReactElement): string {
  return renderToStaticMarkup(element)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');
}

describe('작은 창: 멘션 묶음', () => {
  it('대기열 첫 묶음을 대기열 위치, 상태 태그, 펼쳐 보기와 함께 보이고, 원문 영역에 묶인 멘션 전부를 시간순으로 보인다', () => {
    const text = textOf(<PopoverContent snapshot={snapshot([bundle(1), bundle(2), ANSWERED])} />);

    expect(text).toContain('1 / 2');
    expect(text).toContain('저장소 확인 필요');
    expect(text).toContain('펼쳐 보기');
    expect(text).toContain('원문');
    expect(text).toContain('멘션 2건');
    expect(text.indexOf('@테스트 사용자 첫 질문입니다')).toBeLessThan(text.indexOf('둘째 질문입니다'));
    expect(text).toContain('가짜 게시물 1');
    expect(text).toContain('Flow에서 열기');
    expect(text).toContain('무시');
    expect(text).not.toContain('가짜 게시물 2');
    expect(text).not.toContain('아직 멘션이 없습니다');
  });

  it('저장소 영역은 처음에 접혀 있고, 펼침 상태를 따른다', () => {
    /** 저장소 영역의 안내 문장. */
    const note = '아직 이 묶음에 쓸 저장소를 정하지 않았습니다.';

    expect(textOf(<PopoverContent snapshot={snapshot([bundle(1)])} />)).not.toContain(note);
    expect(
      textOf(
        <PopoverContent
          snapshot={snapshot([bundle(1)], { review: { bundles: [bundle(1)], sections: { ...SECTIONS, compact: { original: false, repository: true } } } })}
        />,
      ),
    ).toEqual(expect.stringContaining(note));
    expect(
      textOf(
        <PopoverContent
          snapshot={snapshot([bundle(1)], { review: { bundles: [bundle(1)], sections: { ...SECTIONS, compact: { original: false, repository: true } } } })}
        />,
      ),
    ).not.toContain('첫 질문입니다');
  });

  it('합쳐진 새 멘션이 있으면 "새 멘션 N건"을 보인다', () => {
    expect(textOf(<PopoverContent snapshot={snapshot([bundle(1, { newMentionCount: 1 })])} />)).toContain('새 멘션 1건');
  });

  it('알림을 눌러 연 묶음을 먼저 보인다. 처리됨 묶음이면 대기열 위치 대신 "처리한 묶음"과 [되돌리기]를 보인다', () => {
    const text = textOf(<PopoverContent snapshot={snapshot([bundle(1), ANSWERED])} initialBundleId={3} />);

    expect(text).toContain('처리한 묶음');
    expect(text).toContain('이미 답함');
    expect(text).toContain('본문 질문');
    expect(text).toContain('되돌리기');
  });

  it('열 주소가 없으면 "Flow에서 열기"를 보이지 않는다', () => {
    expect(textOf(<PopoverContent snapshot={snapshot([bundle(1, { canOpenInFlow: false })])} />)).not.toContain('Flow에서 열기');
  });

  it('처리되지 않은 묶음이 없으면 빈 화면을 보이고, 처리됨 묶음이 있으면 펼쳐 보기로 목록을 열 수 있다', () => {
    const text = textOf(<PopoverContent snapshot={snapshot([ANSWERED])} />);

    expect(text).toContain('아직 멘션이 없습니다.');
    expect(text).toContain('펼쳐 보기');
  });
});

describe('펼친 창', () => {
  it('목록을 검토 대기와 처리됨으로 묶어 개수를 보이고, 행에 송신자·상태를 보이며, 처리됨 아래에 보관 안내를 둔다', () => {
    const text = textOf(<ReviewContent snapshot={snapshot([bundle(1), bundle(2), ANSWERED])} />);

    expect(text).toContain('검토 대기 2');
    expect(text).toContain('처리됨 1');
    expect(text).not.toContain('생성 중');
    expect(text).toContain('보낸 사람, 다른 사람');
    expect(text).toContain('세번째 사람');
    expect(text).toContain('처리한 지 7일이 지나면 목록에서 사라지고 되돌릴 수 없습니다');
    expect(text).toContain('접어 보기');
  });

  it('상세는 고른 묶음의 원문과 저장소를 처음부터 펼쳐 보인다', () => {
    const text = textOf(<ReviewContent snapshot={snapshot([bundle(1), bundle(2)])} initialBundleId={2} />);

    expect(text).toContain('가짜 게시물 2');
    expect(text).toContain('멘션 2건');
    expect(text).toContain('아직 이 묶음에 쓸 저장소를 정하지 않았습니다.');
    expect(text).toContain('Flow에서 열기');
  });

  it('묶음이 하나도 없으면 빈 목록 안내를 보인다', () => {
    expect(textOf(<ReviewContent snapshot={snapshot([])} />)).toContain('아직 멘션이 없습니다.');
  });
});
