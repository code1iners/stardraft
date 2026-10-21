import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AppSnapshot, BundleSnapshot, ReviewSnapshot } from '../../shared/ipc';
import { DiscardEditConfirm, DirectiveForm, RequirementEditor, ThreadList } from './BundleDetail';
import { PopoverContent } from './PopoverView';
import { ReviewContent } from './ReviewView';
import { nextBundleAfter } from './useReview';

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
    directives: [],
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
    posting: null,
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
    editor: { choice: null, installed: [], picker: null },
    review: { bundles, sections: SECTIONS, repoPicker: null },
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
          snapshot={snapshot([bundle(1)], { review: { bundles: [bundle(1)], sections: { ...SECTIONS, compact: { ...SECTIONS.compact, original: false, repository: true } }, repoPicker: null } })}
        />,
      ),
    ).toEqual(expect.stringContaining(note));
    expect(
      textOf(
        <PopoverContent
          snapshot={snapshot([bundle(1)], { review: { bundles: [bundle(1)], sections: { ...SECTIONS, compact: { ...SECTIONS.compact, original: false, repository: true } }, repoPicker: null } })}
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
      {
        sentences: [
          { text: '실제 서비스에서는 다섯 번까지 다시 시도합니다.', evidence: [1], developerTerms: [] },
          { text: '시험 환경은 세 번으로 보입니다.', evidence: [], developerTerms: [] },
        ],
      },
      { sentences: [{ text: '설정을 바꾸면 다음 배포부터 적용됩니다.', evidence: [1, 2], developerTerms: [] }] },
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
        developerTerms: [],
      },
      {
        id: 2,
        explanation: '배포할 때 설정을 새로 읽습니다.',
        repositoryName: 'billing-api',
        path: 'deploy/run.sh',
        startLine: 10,
        endLine: 14,
        located: true,
        developerTerms: [],
      },
    ],
    repositories: [
      { name: 'billing-api', path: '/fake/work/billing-api' },
      { name: 'billing-web', path: '/fake/work/billing-web' },
    ],
    autoSelection: null,
    mapping: 'unmapped',
    editorText: '실제 서비스에서는 다섯 번까지 다시 시도합니다. 시험 환경은 세 번으로 보입니다.\n\n설정을 바꾸면 다음 배포부터 적용됩니다.',
    edited: false,
    canEdit: true,
    recipients: [{ name: '보낸 사람' }, { name: '다른 사람' }],
    postBodyPrefixLength: 59,
    canPost: true,
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
  failure: { reason: 'timed-out', detail: null, lastStep: '검색 중: retry', runKind: 'draft' },
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
    const text = textOf(<PopoverContent snapshot={snapshot([READY], { review: { bundles: [READY], sections, repoPicker: null } })} />);

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
    const text = textOf(<PopoverContent snapshot={snapshot([unlocated], { review: { bundles: [unlocated], sections, repoPicker: null } })} />);

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
        snapshot={snapshot([bundle(8, { status: 'failed', group: 'failed', failure: { reason: 'agent-error', detail: 'Claude usage limit reached.', lastStep: null, runKind: 'draft' } })])}
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

  it.each([
    ['모델 과부하', 'overloaded', '모델이 바빠서 답하지 못했습니다.'],
    ['네트워크 오류', 'network', '모델 서버에 연결하지 못했습니다.'],
  ] as const)('일시적 실패(%s)로 실패한 묶음은 자동으로 한 번 더 시도한 뒤라는 것을 함께 보인다', (_label, reason, sentence) => {
    const text = textOf(
      <PopoverContent snapshot={snapshot([bundle(12, { status: 'failed', group: 'failed', failure: { reason, detail: null, lastStep: '초안 쓰는 중', runKind: 'draft' } })])} />,
    );

    expect(text).toContain(`${sentence} 두 번 시도했습니다.`);
  });

  it('비밀 파일을 근거로 들어 실패한 묶음은 그 사유를 보이고 초안을 보이지 않는다', () => {
    const text = textOf(
      <PopoverContent snapshot={snapshot([bundle(11, { status: 'failed', group: 'failed', failure: { reason: 'secret-evidence', detail: null, lastStep: '초안 쓰는 중', runKind: 'draft' } })])} />,
    );

    expect(text).toContain('비밀 파일을 근거로 듦');
    expect(text).not.toContain('에이전트가 이해한 요구');
    expect(text).toContain('다시 시도');
  });

  it('매핑된 폴더가 없어 저장소 확인 필요가 된 묶음은 저장소 영역에 사유와 찾을 수 없는 폴더를 보인다', () => {
    /** 폴더가 사라진 묶음. */
    const missing = bundle(9, { repoCheck: { kind: 'missing-folders', paths: ['/fake/work/gone'], chosenByUser: false } });
    /** 저장소를 편 작은 창. */
    const sections = { ...SECTIONS, compact: { ...SECTIONS.compact, repository: true } };
    const text = textOf(<PopoverContent snapshot={snapshot([missing], { review: { bundles: [missing], sections, repoPicker: null } })} />);

    expect(text).toContain('연결된 저장소 폴더를 찾을 수 없음');
    expect(text).toContain('/fake/work/gone');
    expect(text).not.toContain('아직 이 묶음에 쓸 저장소를 정하지 않았습니다.');
  });

  it('저장소 선택 창에서 고른 폴더가 사라진 묶음은 "고른 저장소 폴더를 찾을 수 없음"을 보인다', () => {
    /** 고른 폴더가 사라진 묶음. */
    const missing = bundle(10, { repoCheck: { kind: 'missing-folders', paths: ['/fake/work/gone'], chosenByUser: true } });
    /** 저장소를 편 작은 창. */
    const sections = { ...SECTIONS, compact: { ...SECTIONS.compact, repository: true } };
    const text = textOf(<PopoverContent snapshot={snapshot([missing], { review: { bundles: [missing], sections, repoPicker: null } })} />);

    expect(text).toContain('고른 저장소 폴더를 찾을 수 없음');
    expect(text).not.toContain('연결된 저장소 폴더를 찾을 수 없음');
  });
});

describe('저장소 확인 필요와 자동 선택', () => {
  /** 저장소 영역을 편 작은 창의 영역 펼침 상태. */
  const repositoryOpen = { ...SECTIONS, compact: { ...SECTIONS.compact, repository: true } };

  /** 저장소 영역을 편 작은 창에 묶음 하나를 그린 마크업. */
  function popoverMarkup(item: BundleSnapshot): string {
    return renderToStaticMarkup(<PopoverContent snapshot={snapshot([item], { review: { bundles: [item], sections: repositoryOpen, repoPicker: null } })} />);
  }

  /** 저장소 영역을 편 작은 창에 묶음 하나를 그린 글자. 마크업이 바꾼 따옴표는 되돌린다. */
  function popoverText(item: BundleSnapshot): string {
    return popoverMarkup(item).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').replaceAll('&quot;', '"');
  }

  it('선택 실행이 확신하지 못한 묶음은 저장소 영역에 에이전트의 사유, 에이전트가 짚은 후보, 작업 폴더의 다른 후보를 보이고, [저장소를 골라 만들기]·[Flow에서 열기]·[무시]를 둔다', () => {
    /** 선택 실행이 확신하지 못한 묶음. */
    const unsure = bundle(13, {
      repoCheck: {
        kind: 'unsure',
        reason: '재시도 설정이 화면과 서버 양쪽에 있어 어느 쪽을 묻는지 알 수 없습니다.',
        picked: [
          { name: 'team/billing-web', path: '/fake/work/team/billing-web' },
          { name: 'billing-api', path: '/fake/work/billing-api' },
        ],
        others: [{ name: 'team/billing-batch', path: '/fake/work/team/billing-batch' }],
      },
      run: { agent: 'claude-code', durationMs: 62_000, contextOmitted: false },
    });
    /** 마크업. */
    const markup = popoverMarkup(unsure);
    /** 글자. */
    const text = popoverText(unsure);

    expect(text).toContain('저장소 확인 필요');
    expect(text).toContain('에이전트가 저장소를 확신하지 못함');
    expect(text).toContain('재시도 설정이 화면과 서버 양쪽에 있어 어느 쪽을 묻는지 알 수 없습니다.');
    expect(text).toContain('에이전트가 짚은 후보 team/billing-web /fake/work/team/billing-web billing-api /fake/work/billing-api');
    expect(text).toContain('작업 폴더의 다른 후보 1개 team/billing-batch /fake/work/team/billing-batch');
    expect(text).toContain('Claude Code · 1분 2초');
    expect(text).toContain('Flow에서 열기');
    expect(text).toContain('무시');
    expect(markup).toMatch(/<button[^>]*>저장소를 골라 만들기<\/button>/);
    expect(markup).not.toMatch(/<button[^>]*disabled[^>]*>저장소를 골라 만들기<\/button>/);
    expect(text).not.toContain('아직 이 묶음에 쓸 저장소를 정하지 않았습니다.');
  });

  it('코드와 무관한 멘션으로 판정한 묶음은 그 사유를 보이고, 사유가 비어 있으면 "이유 없음"을, 짚은 후보가 없으면 작업 폴더의 후보만 보인다', () => {
    /** 코드와 무관하다고 판정한 묶음. */
    const unrelated = bundle(14, {
      repoCheck: {
        kind: 'unrelated',
        reason: '',
        picked: [],
        others: [
          { name: 'billing-api', path: '/fake/work/billing-api' },
          { name: 'billing-web', path: '/fake/work/billing-web' },
        ],
      },
    });
    /** 글자. */
    const text = popoverText(unrelated);

    expect(text).toContain('에이전트가 코드와 무관한 멘션으로 판정함');
    expect(text).toContain('이유 없음');
    expect(text).not.toContain('에이전트가 짚은 후보');
    expect(text).toContain('작업 폴더의 후보 2개 billing-api /fake/work/billing-api billing-web /fake/work/billing-web');
    expect(text).toContain('저장소를 골라 만들기');
  });

  it('작업 폴더에서 저장소를 찾지 못한 묶음은 그 사유와 작업 폴더를 확인하라는 안내를 보인다', () => {
    /** 후보가 없던 묶음. */
    const none = bundle(15, { repoCheck: { kind: 'no-candidates' } });
    /** 글자. */
    const text = popoverText(none);

    expect(text).toContain('작업 폴더에서 저장소를 찾지 못함');
    expect(text).toContain('설정의 "저장소" 칸에서 작업 폴더를 확인하세요.');
    expect(text).toContain('저장소를 골라 만들기');
  });

  it('자동 선택으로 만든 준비됨 묶음은 저장소 영역에 쓴 저장소와 자동으로 고른 이유를 보인다. 이유가 비어 있으면 "이유 없음", 후보가 하나였으면 그렇게 썼다고 보인다', () => {
    /** 선택 실행이 고른 묶음. */
    const chosen = bundle(16, { ...READY, id: 16, draft: { ...READY.draft!, autoSelection: { kind: 'chosen', reason: '재시도 설정을 묻고 있어 서버 저장소를 골랐습니다.' } } });
    /** 이유 없이 고른 묶음. */
    const noReason = bundle(17, { ...READY, id: 17, draft: { ...READY.draft!, autoSelection: { kind: 'chosen', reason: '' } } });
    /** 후보가 하나였던 묶음. */
    const single = bundle(18, { ...READY, id: 18, draft: { ...READY.draft!, autoSelection: { kind: 'single-candidate' } } });
    /** 펼친 창에 그린 글자. */
    const textFor = (item: BundleSnapshot) => textOf(<ReviewContent snapshot={snapshot([item])} initialBundleId={item.id} />);

    expect(textFor(chosen)).toContain('/fake/work/billing-web');
    expect(textFor(chosen)).toContain('자동으로 고른 이유 재시도 설정을 묻고 있어 서버 저장소를 골랐습니다.');
    expect(textFor(noReason)).toContain('자동으로 고른 이유 이유 없음');
    expect(textFor(single)).toContain('작업 폴더에서 찾은 저장소가 하나라 그 저장소를 썼습니다.');
    expect(textFor(READY)).not.toContain('자동으로 고른 이유');
  });

  it('선택 실행이 5분 제한 시간을 넘겨 실패한 묶음은 저장소를 고르지 못했다고 보인다', () => {
    /** 선택 실행이 시간 초과로 실패한 묶음. */
    const failed = bundle(19, {
      ...FAILED,
      id: 19,
      failure: { reason: 'timed-out', detail: null, lastStep: '파일 읽는 중: README.md', runKind: 'selection' },
      run: { agent: 'claude-code', durationMs: 300_000, contextOmitted: false },
    });
    /** 글자. */
    const text = textOf(<PopoverContent snapshot={snapshot([failed])} />);

    expect(text).toContain('에이전트가 5분 안에 저장소를 고르지 못해 멈췄습니다.');
    expect(text).not.toContain('10분');
    expect(text).toContain('마지막 단계: 파일 읽는 중: README.md');
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

describe('저장소 영역의 연결 버튼과 저장소 선택 창', () => {
  /** 저장소 영역을 편 작은 창의 영역 펼침 상태. */
  const repositoryOpen = { ...SECTIONS, compact: { ...SECTIONS.compact, repository: true } };

  /** 저장소 영역을 편 작은 창에 묶음 하나와 저장소 선택 창을 그린 마크업. */
  function popoverMarkup(item: BundleSnapshot, repoPicker: ReviewSnapshot['repoPicker'] = null): string {
    return renderToStaticMarkup(<PopoverContent snapshot={snapshot([item], { review: { bundles: [item], sections: repositoryOpen, repoPicker } })} />);
  }

  /** 마크업의 글자. */
  function textIn(markup: string): string {
    return markup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  }

  /** 초안이 준비된 묶음. 저장소 매핑과 견준 결과만 바꾼다. */
  function readyWith(mapping: 'unmapped' | 'same' | 'different'): BundleSnapshot {
    return { ...READY, draft: { ...READY.draft!, mapping } };
  }

  it('준비됨 묶음의 저장소 영역에 연결 버튼을 둔다. 매핑이 없으면 "이 Flow 프로젝트에 연결", 다른 구성의 매핑이 있으면 "매핑을 이 구성으로 바꾸기"다', () => {
    expect(popoverMarkup(readyWith('unmapped'))).toMatch(/<button[^>]*>이 Flow 프로젝트에 연결<\/button>/);
    expect(popoverMarkup(readyWith('different'))).toMatch(/<button[^>]*>매핑을 이 구성으로 바꾸기<\/button>/);
    // 이미 이 구성이 매핑이면 누를 일이 없어 꺼 두고 그렇다고 알린다.
    /** 같은 구성의 마크업. */
    const same = popoverMarkup(readyWith('same'));
    expect(same).toMatch(/<button[^>]*disabled[^>]*>매핑을 이 구성으로 바꾸기<\/button>/);
    expect(textIn(same)).toContain('이 Flow 프로젝트의 저장소 매핑이 이 구성입니다.');
  });

  it('준비됨 묶음의 바닥 줄 재생성 메뉴에 "다른 저장소로 다시 만들기"가 있다. 게시 확인 대화상자("앞으로도 이 저장소로?")는 없다', () => {
    /** 글자. */
    const text = textIn(popoverMarkup(readyWith('unmapped')));

    expect(text).toContain('다시 만들기');
    expect(text).toContain('다른 저장소로 다시 만들기');
    expect(text).not.toContain('앞으로도');
  });

  it('저장소 선택 창은 후보를 무리별로 체크 상자와 함께 보이고, "폴더 직접 고르기"·연결 버튼·만들기 버튼을 둔다', () => {
    /** 열린 저장소 선택 창. */
    const picker = {
      bundleId: READY.id,
      status: 'ready' as const,
      choices: [
        { name: 'billing-api', path: '/fake/work/billing-api', group: 'current' as const, checked: true },
        { name: 'team/billing-web', path: '/fake/work/team/billing-web', group: 'work-folder' as const, checked: false },
        { name: 'tool', path: '/fake/other/tool', group: 'mapping' as const, checked: true },
        { name: 'extra', path: '/fake/elsewhere/extra', group: 'added' as const, checked: true },
      ],
      mapping: 'different' as const,
    };
    /** 마크업. */
    const markup = popoverMarkup(readyWith('unmapped'), picker);
    /** 글자. */
    const text = textIn(markup);

    expect(text).toContain('저장소 고르기');
    expect(text).toContain('지금 쓰는 저장소 billing-api /fake/work/billing-api');
    expect(text).toContain('작업 폴더에서 찾은 저장소 team/billing-web /fake/work/team/billing-web');
    expect(text).toContain('다른 매핑에 쓰인 저장소 tool /fake/other/tool');
    expect(text).toContain('직접 고른 폴더 extra /fake/elsewhere/extra');
    expect(markup.match(/type="checkbox" checked=""/g)).toHaveLength(3);
    expect(text).toContain('폴더 직접 고르기');
    expect(markup).toMatch(/<button[^>]*>매핑을 이 구성으로 바꾸기<\/button>/);
    expect(markup).toMatch(/<button[^>]*>이 저장소로 다시 만들기<\/button>/);
    expect(text).toContain('3개 고름');
  });

  it('저장소 확인 필요 묶음의 선택 창은 "이 저장소로 만들기"이고, 고른 것이 없으면 만들기와 연결을 끈다. 훑는 동안에는 찾는 중이라고 보인다', () => {
    /** 저장소 확인 필요 묶음. */
    const check = bundle(21, { repoCheck: { kind: 'no-candidates' } });
    /** 아무것도 고르지 않은 창. */
    const markup = popoverMarkup(check, {
      bundleId: 21,
      status: 'ready',
      choices: [{ name: 'billing-api', path: '/fake/work/billing-api', group: 'work-folder', checked: false }],
      mapping: 'unmapped',
    });

    expect(markup).toMatch(/<button[^>]*disabled[^>]*>이 저장소로 만들기<\/button>/);
    expect(markup).toMatch(/<button[^>]*disabled[^>]*>이 Flow 프로젝트에 연결<\/button>/);
    expect(textIn(popoverMarkup(check, { bundleId: 21, status: 'loading' }))).toContain('작업 폴더에서 저장소를 찾는 중입니다.');
  });
});

describe('초안 편집기와 받는 사람', () => {
  /** 초안을 편집한 묶음. */
  function edited(text: string): BundleSnapshot {
    return { ...READY, draft: { ...READY.draft!, editorText: text, edited: true } };
  }

  it('초안 머리 바로 아래에 받는 사람 줄을 두고 사람마다 ×로 뺄 수 있게 하며, 그 아래 편집기에 근거 번호가 붙은 초안과 받는 사람 표기를 포함한 글자 수를 보인다', () => {
    /** 그린 HTML. */
    const html = renderToStaticMarkup(<PopoverContent snapshot={snapshot([READY])} />);
    const text = textOf(<PopoverContent snapshot={snapshot([READY])} />);

    expect(text).toContain('받는 사람 @보낸 사람 × @다른 사람 ×');
    expect(html).toContain('aria-label="보낸 사람 빼기"');
    expect(html).toContain('aria-label="다른 사람 빼기"');
    expect(text.indexOf('받는 사람 @보낸 사람')).toBeLessThan(text.indexOf('실제 서비스에서는 다섯 번까지 다시 시도합니다. ①'));
    // 받는 사람 표기 59자와 편집기 텍스트 69자.
    expect(text).toContain('글자 수 128 / 4,000');
    expect(text).not.toContain('원래 초안으로 되돌리기');
    // 받는 사람을 더하는 기능은 없다.
    expect(text).not.toContain('받는 사람 추가');
  });

  it('편집한 초안은 근거 번호 없이 편집본을 편집기에 보이고 "원래 초안으로 되돌리기"를 둔다', () => {
    /** 그린 HTML. */
    const html = renderToStaticMarkup(<PopoverContent snapshot={snapshot([edited('재시도는 다섯 번입니다.\n\n시험 환경은 다릅니다.')])} />);
    const text = textOf(<PopoverContent snapshot={snapshot([edited('재시도는 다섯 번입니다.\n\n시험 환경은 다릅니다.')])} />);

    expect(html).toContain('<textarea');
    expect(html).toContain('재시도는 다섯 번입니다.\n\n시험 환경은 다릅니다.');
    expect(text).not.toContain('①');
    expect(text).not.toContain('근거 없음');
    expect(text).toContain('원래 초안으로 되돌리기');
  });

  it('게시 본문이 4,000자를 넘으면 편집기 아래에 Flow 댓글 길이 제한 안내를 보인다. 앞뒤 공백은 세지 않는다', () => {
    // 받는 사람 표기 59자와 편집기 텍스트 4,061자를 더하면 4,120자다.
    const over = textOf(<PopoverContent snapshot={snapshot([edited(`  ${'가'.repeat(4_061)}\n`)])} />);
    const fits = textOf(<PopoverContent snapshot={snapshot([edited('가'.repeat(3_941))])} />);

    expect(over).toContain('Flow 댓글 길이 제한을 넘었습니다 (4,120 / 4,000)');
    expect(fits).toContain('글자 수 4,000 / 4,000');
    expect(fits).not.toContain('Flow 댓글 길이 제한을 넘었습니다');
  });

  it('받는 사람을 모두 빼면 멘션 없이 올린다고 보이고, 글자 수는 편집기 텍스트만 센다', () => {
    /** 받는 사람이 없는 묶음. */
    const none = { ...READY, draft: { ...READY.draft!, recipients: [], postBodyPrefixLength: 0 } };
    const text = textOf(<PopoverContent snapshot={snapshot([none])} />);

    expect(text).toContain('받는 사람 없음 · 멘션 없이 올립니다');
    expect(text).toContain('글자 수 69 / 4,000');
  });

  it('고칠 수 없는 묶음(처리됨)의 초안은 받는 사람을 뺄 수 없고 되돌리기도 없으며, 편집본은 글로만 보인다', () => {
    /** 편집한 뒤 무시한 묶음. */
    const ignored: BundleSnapshot = {
      ...edited('고친 초안입니다.'),
      status: 'ignored',
      group: 'processed',
      canRestore: true,
      processedAt: Date.UTC(2026, 9, 20, 0, 0),
      draft: { ...edited('고친 초안입니다.').draft!, canEdit: false },
    };
    /** 그린 HTML. */
    const html = renderToStaticMarkup(<ReviewContent snapshot={snapshot([ignored])} initialBundleId={4} />);

    expect(html).toContain('고친 초안입니다.');
    expect(html).not.toContain('<textarea');
    expect(html).not.toContain('빼기"');
    expect(html).not.toContain('원래 초안으로 되돌리기');
  });
});

describe('재생성', () => {
  /** 그린 HTML에서 태그를 지운 글자. 공백은 하나로 줄인다. */
  function textIn(markup: string): string {
    return markup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  }

  /** 초안을 편집한 준비됨 묶음. */
  const EDITED: BundleSnapshot = { ...READY, draft: { ...READY.draft!, editorText: '고친 초안입니다.', edited: true } };

  it('준비됨 묶음의 바닥 줄 재생성 메뉴에 다시 만들기, 지시를 덧붙여 다시 만들기, 다른 저장소로 다시 만들기가 이 순서로 있다', () => {
    /** 그린 HTML. */
    const html = renderToStaticMarkup(<PopoverContent snapshot={snapshot([READY])} />);
    /** 메뉴 항목. */
    const items = [...html.matchAll(/<button[^>]*role="menuitem"[^>]*>([^<]*)<\/button>/g)].map((match) => match[1]);

    expect(items).toEqual(['다시 만들기', '지시를 덧붙여 다시 만들기', '다른 저장소로 다시 만들기']);
  });

  it('준비됨 묶음은 "에이전트가 이해한 요구" 제목 옆에 요구를 고치는 망치 버튼을 두고, 고칠 수 없는 묶음에는 두지 않는다', () => {
    /** 처리됨 묶음. */
    const ignored: BundleSnapshot = { ...READY, status: 'ignored', group: 'processed', canRestore: true, draft: { ...READY.draft!, canEdit: false } };

    expect(renderToStaticMarkup(<PopoverContent snapshot={snapshot([READY])} />)).toContain('aria-label="요구 고치기"');
    expect(renderToStaticMarkup(<ReviewContent snapshot={snapshot([ignored])} initialBundleId={4} />)).not.toContain('aria-label="요구 고치기"');
  });

  it('손댄 준비됨 묶음에 새 멘션이 합쳐졌으면 "새 멘션 1건"과 [다시 만들기]를, 저장소 확인 필요 묶음에는 "새 멘션 1건"만 보인다', () => {
    /** 새 멘션이 합쳐진 준비됨 묶음의 알림 줄. */
    const ready = renderToStaticMarkup(<PopoverContent snapshot={snapshot([{ ...EDITED, newMentionCount: 1 }])} />);
    /** 새 멘션이 합쳐진 저장소 확인 필요 묶음의 알림 줄. */
    const check = renderToStaticMarkup(<PopoverContent snapshot={snapshot([bundle(1, { newMentionCount: 1 })])} />);

    expect(ready).toMatch(/<div class="notice-line"[^>]*><span>새 멘션 1건<\/span><button[^>]*>다시 만들기<\/button><\/div>/);
    expect(check).toContain('<div class="notice-line"><span>새 멘션 1건</span></div>');
  });

  it('편집한 초안이 있으면 다시 만들기 전에 편집본을 버릴지 묻는다', () => {
    const text = textOf(<DiscardEditConfirm onConfirm={() => {}} onCancel={() => {}} />);

    expect(text).toContain('편집한 초안을 버리고 다시 만들까요?');
    expect(text).toContain('취소');
    expect(text).toContain('버리고 다시 만들기');
  });

  it('지시를 덧붙이는 칸은 앞서 덧붙인 지시를 함께 넘긴다고 보이고, 편집한 초안이 있으면 버린다고 알린다. 빈 지시로는 다시 만들 수 없다', () => {
    /** 처음 지시를 덧붙이는 칸. */
    const first = renderToStaticMarkup(<DirectiveForm bundleId={4} directives={[]} edited={false} onClose={() => {}} />);
    /** 지시를 덧붙인 적이 있고 초안을 편집한 묶음의 칸. */
    const again = renderToStaticMarkup(<DirectiveForm bundleId={4} directives={['더 짧게', '존댓말로']} edited onClose={() => {}} />);

    expect(textIn(first)).toContain('덧붙일 지시');
    expect(first).toMatch(/<button[^>]*disabled[^>]*>지시를 덧붙여 다시 만들기<\/button>/);
    expect(textIn(first)).not.toContain('앞서 덧붙인 지시');
    expect(textIn(again)).toContain('앞서 덧붙인 지시도 함께 넘깁니다');
    expect(textIn(again)).toContain('더 짧게');
    expect(textIn(again)).toContain('존댓말로');
    expect(textIn(again)).toContain('편집한 초안은 버리고 다시 만듭니다.');
    expect(textIn(again)).toContain('편집본을 버리고 다시 만들기');
  });

  it('요구를 고치는 칸은 지금 요구를 채워 두고 "이 요구로 재생성"을 두며, 덧붙인 지시가 지워진다고 알린다', () => {
    /** 지시를 덧붙인 적이 있는 묶음의 요구 칸. */
    const html = renderToStaticMarkup(<RequirementEditor bundleId={4} requirement="재시도 횟수를 알고 싶다." directiveCount={2} edited={false} onClose={() => {}} />);
    /** 초안을 편집한 묶음의 요구 칸. */
    const edited = renderToStaticMarkup(<RequirementEditor bundleId={4} requirement="재시도 횟수를 알고 싶다." directiveCount={0} edited onClose={() => {}} />);

    expect(html).toMatch(/<textarea[^>]*>재시도 횟수를 알고 싶다.<\/textarea>/);
    expect(textIn(html)).toContain('이 요구로 재생성');
    expect(textIn(html)).toContain('덧붙인 지시 2개는 지워집니다.');
    expect(textIn(edited)).toContain('편집한 초안은 버리고 다시 만듭니다.');
    expect(textIn(edited)).toContain('편집본을 버리고 이 요구로 재생성');
    expect(textIn(edited)).not.toContain('덧붙인 지시');
  });
});

describe('근거와 에디터에서 열기', () => {
  /** 근거를 편 작은 창. */
  const evidenceOpen = { ...SECTIONS, compact: { ...SECTIONS.compact, evidence: true } };

  it('초안의 근거 번호는 근거를 펼쳐 보는 버튼이다. 근거 없는 문장은 "근거 없음"이다', () => {
    /** 그린 HTML. */
    const html = renderToStaticMarkup(<PopoverContent snapshot={snapshot([READY])} />);

    expect(html).toContain('aria-label="근거 ① 보기"');
    expect(html).toContain('aria-label="근거 ② 보기"');
    expect(textOf(<PopoverContent snapshot={snapshot([READY])} />)).toContain('시험 환경은 세 번으로 보입니다. 근거 없음');
  });

  it('위치를 찾은 근거마다 "에디터에서 열기"를 두고, 위치를 찾을 수 없는 근거는 끈다', () => {
    /** 둘째 근거의 위치를 찾지 못한 묶음. */
    const unlocated = bundle(10, {
      ...READY,
      draft: { ...READY.draft!, evidence: [READY.draft!.evidence[0]!, { ...READY.draft!.evidence[1]!, located: false }] },
    });
    /** 그린 HTML. */
    const html = renderToStaticMarkup(<PopoverContent snapshot={snapshot([unlocated], { review: { bundles: [unlocated], sections: evidenceOpen, repoPicker: null } })} />);

    expect(html.match(/에디터에서 열기/g)).toHaveLength(2);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>에디터에서 열기<\/button>/);
  });

  it('문체 검사에 걸린 초안 문장과 근거 설명 옆에 "개발자 용어가 있을 수 있음"을 작게 보인다', () => {
    /** 첫 문장과 첫 근거 설명이 걸린 묶음. */
    const flagged = bundle(11, {
      ...READY,
      draft: {
        ...READY.draft!,
        paragraphs: [{ sentences: [{ text: 'retryCount로 정합니다.', evidence: [1], developerTerms: ['retryCount'] }] }],
        evidence: [{ ...READY.draft!.evidence[0]!, explanation: 'application-prod.yml에서 정합니다.', developerTerms: ['application-prod.yml'] }],
      },
    });
    /** 그린 HTML. */
    const html = renderToStaticMarkup(<PopoverContent snapshot={snapshot([flagged], { review: { bundles: [flagged], sections: evidenceOpen, repoPicker: null } })} />);

    expect(html.match(/개발자 용어가 있을 수 있음/g)).toHaveLength(2);
    expect(html).toContain('title="retryCount"');
    expect(html).toContain('title="application-prod.yml"');
    expect(renderToStaticMarkup(<PopoverContent snapshot={snapshot([READY], { review: { bundles: [READY], sections: evidenceOpen, repoPicker: null } })} />)).not.toContain(
      '개발자 용어가 있을 수 있음',
    );
  });

  it('처음 열 때는 찾은 에디터를 고르는 창을 작은 창과 펼친 창에 띄운다', () => {
    /** 에디터 고르기 창이 열린 상태. */
    const editor = {
      choice: null,
      installed: [
        { appId: 'vscode', name: 'VS Code' },
        { appId: 'jetbrains:IntelliJ IDEA', name: 'IntelliJ IDEA' },
      ],
      picker: {
        editors: [
          { appId: 'vscode', name: 'VS Code' },
          { appId: 'jetbrains:IntelliJ IDEA', name: 'IntelliJ IDEA' },
        ],
      },
    };

    for (const text of [
      textOf(<PopoverContent snapshot={snapshot([READY], { editor })} />),
      textOf(<ReviewContent snapshot={snapshot([READY], { editor })} initialBundleId={READY.id} />),
    ]) {
      expect(text).toContain('근거를 열 에디터 고르기');
      expect(text).toContain('VS Code');
      expect(text).toContain('IntelliJ IDEA');
      expect(text).toContain('다음부터는 바로 열고');
    }
  });
});

describe('게시', () => {
  /** 그린 HTML에서 [게시] 버튼. 없으면 `undefined`. */
  function postButton(html: string): string | undefined {
    return html.match(/<button[^>]*>게시<\/button>/)?.[0];
  }

  /** 카운트다운 중인 게시 중 묶음. 지금부터 5초 뒤에 게시 요청을 보낸다. */
  function countingDown(): BundleSnapshot {
    return {
      ...READY,
      id: 8,
      status: 'posting',
      draft: { ...READY.draft!, canEdit: false, canPost: false },
      posting: { phase: 'countdown', endsAt: Date.now() + 5_000 },
    };
  }

  it('준비됨 묶음의 바닥 줄 오른쪽에 재생성 메뉴와 [게시]를 둔다. 게시할 수 없는 초안이면 [게시]를 끈다', () => {
    /** 게시할 수 없는 묶음(빈 편집기 텍스트나 4,000자 초과). */
    const blocked: BundleSnapshot = { ...READY, draft: { ...READY.draft!, canPost: false } };
    /** 그린 HTML. */
    const html = renderToStaticMarkup(<PopoverContent snapshot={snapshot([READY])} />);

    expect(postButton(html)).toBeDefined();
    expect(postButton(html)).not.toContain('disabled');
    expect(html.indexOf('다시 만들기 ▾')).toBeLessThan(html.indexOf(postButton(html)!));
    expect(postButton(renderToStaticMarkup(<PopoverContent snapshot={snapshot([blocked])} />))).toContain('disabled');
    // 확인 창은 없다.
    expect(textOf(<PopoverContent snapshot={snapshot([READY])} />)).not.toContain('게시할까요');
  });

  it('카운트다운 중인 게시 중 묶음은 "게시 중" 태그와, 바닥 줄에 남은 초와 [취소]만 둔다. [무시]·[게시]·재생성 메뉴는 없다', () => {
    /** 그린 HTML. */
    const html = renderToStaticMarkup(<PopoverContent snapshot={snapshot([countingDown()])} initialBundleId={8} />);
    const text = textOf(<PopoverContent snapshot={snapshot([countingDown()])} initialBundleId={8} />);

    expect(text).toContain('게시 중');
    expect(text).toContain('5초 뒤 게시합니다.');
    expect(text).toContain('취소');
    expect(text).not.toContain('무시');
    expect(postButton(html)).toBeUndefined();
    expect(text).not.toContain('다시 만들기 ▾');
    expect(html).not.toContain('<textarea');
  });

  it('게시 요청을 보낸 게시 중 묶음은 결과를 기다린다고 보이고 [게시]를 끈 채로 두며 취소할 수 없다', () => {
    /** 게시 요청을 보낸 묶음. */
    const sending: BundleSnapshot = { ...countingDown(), posting: { phase: 'sending' } };
    /** 그린 HTML. */
    const html = renderToStaticMarkup(<PopoverContent snapshot={snapshot([sending])} />);
    const text = textOf(<PopoverContent snapshot={snapshot([sending])} />);

    expect(text).toContain('게시 결과를 기다리는 중입니다.');
    expect(postButton(html)).toContain('disabled');
    expect(text).not.toContain('취소');
  });

  it('게시 중 묶음이 있으면 다른 묶음을 보고 있어도 창 아래에 카운트다운 토스트와 [취소]를 보인다. 펼친 창도 같다', () => {
    /** 게시 중 묶음과 다음 준비된 묶음. */
    const bundles = [countingDown(), { ...READY, id: 9 }];

    for (const text of [
      textOf(<PopoverContent snapshot={snapshot(bundles)} initialBundleId={9} />),
      textOf(<ReviewContent snapshot={snapshot(bundles)} initialBundleId={9} />),
    ]) {
      expect(text).toContain('5초 뒤 게시합니다: 보낸 사람, 다른 사람님 멘션 취소');
    }
  });

  it('펼친 창에서 게시 중 묶음은 검토 대기에 남고, 게시됨 묶음은 처리됨에 들며 되돌릴 수 없다', () => {
    /** 게시됨 묶음. */
    const posted: BundleSnapshot = { ...READY, id: 10, status: 'posted', group: 'processed', processedAt: Date.UTC(2026, 9, 20, 0, 5), draft: { ...READY.draft!, canEdit: false, canPost: false } };
    const list = textOf(<ReviewContent snapshot={snapshot([countingDown(), posted])} initialBundleId={10} />);

    expect(list).toContain('검토 대기 1');
    expect(list).toContain('처리됨 1');
    expect(list).toContain('게시됨');
    expect(list).toContain('게시한 묶음입니다. 되돌릴 수 없습니다.');
    expect(list).not.toContain('되돌리기');
  });
});

describe('게시하거나 무시한 뒤 넘어갈 묶음', () => {
  /** 준비됨, 생성 중, 저장소 확인 필요, 실패, 게시 중 묶음이 섞인 대기열. */
  const queue = [{ ...READY, id: 1 }, GENERATING, bundle(2), FAILED, { ...READY, id: 3, status: 'posting' as const }, { ...READY, id: 4 }];

  it('떠나는 묶음 뒤에서 검토할 수 있는 다음 묶음(준비됨, 저장소 확인 필요)으로 넘어가고, 뒤에 없으면 앞에서 찾는다', () => {
    expect(nextBundleAfter(queue, 1)?.id).toBe(2);
    expect(nextBundleAfter(queue, 2)?.id).toBe(4);
    expect(nextBundleAfter(queue, 4)?.id).toBe(1);
  });

  it('검토할 수 있는 묶음이 없으면 바로 뒤, 그것도 없으면 바로 앞 묶음이고, 떠나는 묶음뿐이면 없다', () => {
    expect(nextBundleAfter([{ ...READY, id: 1 }, GENERATING], 1)?.id).toBe(GENERATING.id);
    expect(nextBundleAfter([FAILED, { ...READY, id: 1 }], 1)?.id).toBe(FAILED.id);
    expect(nextBundleAfter([{ ...READY, id: 1 }], 1)).toBeNull();
  });
});
