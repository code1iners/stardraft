import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AppSnapshot, BundleSnapshot, ReviewSnapshot } from '../../shared/ipc';
import { ThreadList } from './BundleDetail';
import { PopoverContent } from './PopoverView';
import { ReviewContent } from './ReviewView';

/** 창마다 처음 영역 펼침 상태. */
const SECTIONS: ReviewSnapshot['sections'] = {
  compact: { original: true, requirement: true, draft: true, evidence: false, repository: false, progress: true },
  expanded: { original: true, requirement: true, draft: true, evidence: true, repository: true, progress: true },
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
    thread: [],
    draft: null,
    run: null,
    generation: null,
    failure: null,
    repoCheck: null,
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
          snapshot={snapshot([bundle(1)], { review: { bundles: [bundle(1)], sections: { ...SECTIONS, compact: { ...SECTIONS.compact, original: false, repository: true } } } })}
        />,
      ),
    ).toEqual(expect.stringContaining(note));
    expect(
      textOf(
        <PopoverContent
          snapshot={snapshot([bundle(1)], { review: { bundles: [bundle(1)], sections: { ...SECTIONS, compact: { ...SECTIONS.compact, original: false, repository: true } } } })}
        />,
      ),
    ).not.toContain('첫 질문입니다');
  });

  it('맥락을 조회한 묶음은 원문 영역에 "스레드 보기"를 두고, 맥락이 없으면 두지 않는다', () => {
    /** 본문, 멘션인 머리 댓글, 앞선 대댓글이 든 스레드. */
    const thread: BundleSnapshot['thread'] = [
      { authorName: '글쓴이', place: 'post', at: null, text: [{ text: '게시물 본문', mention: false }], attachments: [], mention: false },
      { authorName: '보낸 사람', place: 'comment', at: null, text: [{ text: '첫 질문입니다', mention: false }], attachments: [], mention: true },
    ];

    expect(textOf(<PopoverContent snapshot={snapshot([bundle(1, { thread })])} />)).toContain('스레드 보기');
    expect(textOf(<PopoverContent snapshot={snapshot([bundle(1, { thread })])} />)).not.toContain('게시물 본문');
    expect(textOf(<PopoverContent snapshot={snapshot([bundle(1)])} />)).not.toContain('스레드 보기');
  });

  it('스레드 보기는 앞선 글과 멘션을 시간순으로 보이고, 멘션과 첨부 파일 이름을 표시한다', () => {
    const text = textOf(
      <ThreadList
        entries={[
          { authorName: '글쓴이', place: 'post', at: null, text: [{ text: '게시물 본문', mention: false }], attachments: ['설계서.pdf'], mention: false },
          {
            authorName: '보낸 사람',
            place: 'comment',
            at: Date.UTC(2026, 9, 19, 23, 50),
            text: [{ text: '@테스트 사용자', mention: true }, { text: ' 질문', mention: false }],
            attachments: [],
            mention: true,
          },
          { authorName: '', place: 'reply', at: null, text: [{ text: '앞선 대댓글', mention: false }], attachments: [], mention: false },
        ]}
      />,
    );

    expect(text.indexOf('게시물 본문')).toBeLessThan(text.indexOf('@테스트 사용자 질문'));
    expect(text.indexOf('@테스트 사용자 질문')).toBeLessThan(text.indexOf('앞선 대댓글'));
    expect(text).toContain('첨부 있음(설계서.pdf)');
    expect(text).toContain('보낸 사람 댓글');
    expect(text).toContain('멘션');
    expect(text).toContain('이름 없음 대댓글');
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

/** 초안이 준비된 묶음. 문장 하나는 근거가 있고 하나는 없다. */
const READY = bundle(4, {
  status: 'ready',
  group: 'awaiting-review',
  draft: {
    requirement: { text: '실제 서비스에서 재시도를 몇 번 하는지 알고 싶다.', summary: '재시도 횟수' },
    paragraphs: [
      { sentences: [{ text: '실제 서비스에서는 다섯 번까지 다시 시도합니다.', evidence: [1] }, { text: '시험 환경은 세 번으로 보입니다.', evidence: [] }] },
      { sentences: [{ text: '설정을 바꾸면 다음 배포부터 적용됩니다.', evidence: [1, 2] }] },
    ],
    evidence: [
      {
        id: 1,
        explanation: '운영 설정에서 다시 시도하는 횟수를 5로 정해 둡니다.',
        repositoryName: 'billing-api',
        path: 'src/main/resources/application-prod.yml',
        startLine: 88,
        endLine: 88,
        located: true,
      },
      { id: 2, explanation: '배포할 때 설정을 새로 읽습니다.', repositoryName: 'billing-api', path: 'deploy/run.sh', startLine: 10, endLine: 14, located: true },
    ],
    repositories: [
      { name: 'billing-api', path: '/fake/work/billing-api' },
      { name: 'billing-web', path: '/fake/work/billing-web' },
    ],
  },
  run: { agent: 'claude-code', durationMs: 134_000, contextOmitted: true },
});

/** 실행 중인 생성 중 묶음. */
const GENERATING = bundle(5, {
  status: 'generating',
  group: 'generating',
  generation: { status: 'running', step: '파일 읽는 중: RetryConfig.kt', filesRead: 2 },
});

/** 시간 초과로 실패한 묶음. */
const FAILED = bundle(6, {
  status: 'failed',
  group: 'failed',
  failure: { reason: 'timed-out', detail: null, lastStep: '검색 중: retry' },
  run: { agent: 'claude-code', durationMs: 600_000, contextOmitted: false },
});

describe('작은 창: 초안 실행', () => {
  it('준비됨 묶음은 원문 → 에이전트가 이해한 요구 → 문장마다 근거 번호가 붙은 초안 순으로 보이고, 근거 없는 문장에는 "근거 없음"을, 머리에 실행 줄을 보인다', () => {
    const text = textOf(<PopoverContent snapshot={snapshot([READY])} />);

    expect(text).toContain('준비됨');
    expect(text).toContain('Claude Code · 2분 14초 · 맥락 일부 생략');
    expect(text.indexOf('원문')).toBeLessThan(text.indexOf('에이전트가 이해한 요구'));
    expect(text.indexOf('에이전트가 이해한 요구')).toBeLessThan(text.indexOf('실제 서비스에서 재시도를 몇 번 하는지 알고 싶다.'));
    expect(text.indexOf('실제 서비스에서 재시도를 몇 번 하는지 알고 싶다.')).toBeLessThan(text.indexOf('초안'));
    expect(text).toContain('실제 서비스에서는 다섯 번까지 다시 시도합니다. ①');
    expect(text).toContain('시험 환경은 세 번으로 보입니다. 근거 없음');
    expect(text).toContain('설정을 바꾸면 다음 배포부터 적용됩니다. ① ②');
    expect(text).toContain('근거 2개');
    // 근거와 저장소는 처음에 접혀 있다.
    expect(text).not.toContain('운영 설정에서 다시 시도하는 횟수를 5로 정해 둡니다.');
    expect(text).not.toContain('/fake/work/billing-web');
  });

  it('근거를 펼치면 근거마다 자연어 설명과 "저장소 · 파일 · 줄" 위치를, 저장소를 펼치면 쓴 저장소를 보인다', () => {
    /** 근거와 저장소를 편 작은 창. */
    const sections = { ...SECTIONS, compact: { ...SECTIONS.compact, evidence: true, repository: true } };
    const text = textOf(<PopoverContent snapshot={snapshot([READY], { review: { bundles: [READY], sections } })} />);

    expect(text).toContain('① 운영 설정에서 다시 시도하는 횟수를 5로 정해 둡니다.');
    expect(text).toContain('billing-api · application-prod.yml · 88번째 줄');
    expect(text).toContain('② 배포할 때 설정을 새로 읽습니다.');
    expect(text).toContain('billing-api · run.sh · 10–14번째 줄');
    expect(text).toContain('billing-web');
    expect(text).toContain('/fake/work/billing-web');
  });

  it('위치를 찾을 수 없는 근거는 지우지 않고 "위치를 찾을 수 없음"으로 보이며, 그 근거를 단 문장의 번호는 그대로다', () => {
    /** 둘째 근거의 위치를 찾지 못한 묶음. */
    const unlocated = bundle(10, {
      ...READY,
      draft: { ...READY.draft!, evidence: [READY.draft!.evidence[0]!, { ...READY.draft!.evidence[1]!, located: false }] },
    });
    /** 근거를 편 작은 창. */
    const sections = { ...SECTIONS, compact: { ...SECTIONS.compact, evidence: true } };
    const text = textOf(<PopoverContent snapshot={snapshot([unlocated], { review: { bundles: [unlocated], sections } })} />);

    expect(text).toContain('설정을 바꾸면 다음 배포부터 적용됩니다. ① ②');
    expect(text).toContain('billing-api · application-prod.yml · 88번째 줄');
    expect(text).toContain('② 배포할 때 설정을 새로 읽습니다.');
    expect(text).toContain('위치를 찾을 수 없음');
    expect(text).not.toContain('run.sh');
  });

  it('생성 중 묶음은 진행 단계 한 줄과 읽은 파일 수, [취소]를 보이고 [무시]는 두지 않는다. 기다리는 묶음은 차례를 기다린다고 보인다', () => {
    const text = textOf(<PopoverContent snapshot={snapshot([GENERATING])} />);
    const waiting = textOf(<PopoverContent snapshot={snapshot([bundle(7, { status: 'generating', group: 'generating', generation: { status: 'waiting' } })])} />);

    expect(text).toContain('생성 중');
    expect(text).toContain('파일 읽는 중: RetryConfig.kt');
    expect(text).toContain('읽은 파일 2개');
    expect(text).toContain('취소');
    expect(text).not.toContain('무시');
    expect(text).not.toContain('에이전트가 이해한 요구');
    expect(waiting).toContain('차례를 기다리는 중');
  });

  it('실패 묶음은 오류와 마지막 단계, [다시 시도]와 [무시]를 보인다', () => {
    const text = textOf(<PopoverContent snapshot={snapshot([FAILED])} />);
    const withDetail = textOf(
      <PopoverContent
        snapshot={snapshot([bundle(8, { status: 'failed', group: 'failed', failure: { reason: 'agent-error', detail: 'Claude usage limit reached.', lastStep: null } })])}
      />,
    );

    expect(text).toContain('실패');
    expect(text).toContain('에이전트가 10분 안에 끝내지 못해 멈췄습니다.');
    expect(text).toContain('마지막 단계: 검색 중: retry');
    expect(text).toContain('Claude Code · 10분');
    expect(text).toContain('다시 시도');
    expect(text).toContain('무시');
    expect(withDetail).toContain('Claude usage limit reached.');
    expect(withDetail).not.toContain('마지막 단계');
  });

  it('비밀 파일을 근거로 들어 실패한 묶음은 그 사유를 보이고 초안을 보이지 않는다', () => {
    const text = textOf(
      <PopoverContent snapshot={snapshot([bundle(11, { status: 'failed', group: 'failed', failure: { reason: 'secret-evidence', detail: null, lastStep: '초안 쓰는 중' } })])} />,
    );

    expect(text).toContain('비밀 파일을 근거로 듦');
    expect(text).not.toContain('에이전트가 이해한 요구');
    expect(text).toContain('다시 시도');
  });

  it('매핑된 폴더가 없어 저장소 확인 필요가 된 묶음은 저장소 영역에 사유와 찾을 수 없는 폴더를 보인다', () => {
    /** 폴더가 사라진 묶음. */
    const missing = bundle(9, { repoCheck: { kind: 'missing-folders', paths: ['/fake/work/gone'] } });
    /** 저장소를 편 작은 창. */
    const sections = { ...SECTIONS, compact: { ...SECTIONS.compact, repository: true } };
    const text = textOf(<PopoverContent snapshot={snapshot([missing], { review: { bundles: [missing], sections } })} />);

    expect(text).toContain('연결된 저장소 폴더를 찾을 수 없음');
    expect(text).toContain('/fake/work/gone');
    expect(text).not.toContain('아직 이 묶음에 쓸 저장소를 정하지 않았습니다.');
  });
});

describe('펼친 창: 초안 실행', () => {
  it('목록 행에 요구 요약을 보이고, 생성 중·실패 묶음을 각 목록 묶음에 넣는다. 상세는 원문 → 요구 → 저장소 → 초안 → 근거 순이고 머리에 실행 줄이 있다', () => {
    const text = textOf(<ReviewContent snapshot={snapshot([READY, GENERATING, FAILED])} initialBundleId={4} />);

    expect(text).toContain('검토 대기 1');
    expect(text).toContain('생성 중 1');
    expect(text).toContain('실패 1');
    expect(text).toContain('재시도 횟수');
    expect(text).toContain('Claude Code · 2분 14초 · 맥락 일부 생략');
    /** 상세 영역의 머리 순서. */
    const order = ['에이전트가 이해한 요구', '저장소', '초안', '근거 2개'].map((title) => text.indexOf(title, text.indexOf('원문')));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(text).toContain('billing-api · application-prod.yml · 88번째 줄');
  });
});
