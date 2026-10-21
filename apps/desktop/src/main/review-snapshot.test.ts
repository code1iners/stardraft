import { describe, expect, it } from 'vitest';
import type { BundledMention, MentionBundle } from '../core/bundles/mention-bundle';
import type { RunRecord } from '../core/drafts/draft';
import type { BundleContext } from '../core/flow/bundle-context';
import { POST_BODY_CHAR_LIMIT as CORE_POST_BODY_CHAR_LIMIT } from '../core/drafts/post-body';
import { POST_BODY_CHAR_LIMIT } from '../shared/ipc';
import { bundleSnapshot, flowUrlOf, reviewSnapshot } from './review-snapshot';

/** 가짜 멘션. 실제 사람이나 글이 아니다. 기본은 08:50(한국 표준시)에 온 댓글 멘션이다. */
function mention(alarmId: string, overrides: Partial<BundledMention> = {}): BundledMention {
  return {
    postId: '90000011',
    remarkId: '700',
    replyId: '-1',
    projectId: '900001',
    alarmId,
    senderId: 'sender@example.test',
    senderName: '보낸 사람',
    registeredDateTime: '20261020085000',
    detectedAt: 1_000,
    text: '@[테스트 사용자](me@example.test) 질문',
    answered: false,
    ...overrides,
  };
}

/** 가짜 댓글 스레드 묶음. */
function bundle(overrides: Partial<MentionBundle> = {}): MentionBundle {
  return {
    id: 7,
    postId: '90000011',
    remarkId: '700',
    projectId: '900001',
    status: 'repo-check-needed',
    postTitle: '가짜 게시물',
    connectUrl: 'https://fake.flow.test/post/90000011',
    mentions: [mention('101')],
    answers: [],
    newMentionCount: 0,
    createdAt: 1_000,
    processedAt: null,
    context: null,
    userRepos: null,
    repoCheck: null,
    draft: null,
    editedText: null,
    removedRecipients: [],
    directives: [],
    fixedRequirement: null,
    regeneration: null,
    failure: null,
    runs: [],
    posting: null,
    ...overrides,
  };
}

/** 가짜 실행 기록. 기본은 2분 14초 걸려 성공한 초안 실행이다. */
function run(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    kind: 'draft',
    agent: 'claude-code',
    cliVersion: '2.1.305',
    model: 'sonnet',
    startedAt: 10_000,
    finishedAt: 144_000,
    result: 'succeeded',
    detail: null,
    lastStep: '파일 읽는 중: config.yml',
    fixes: [],
    omittedContextItems: 0,
    usage: { costUsd: 0.5, inputTokens: 100, outputTokens: 20 },
    ...overrides,
  };
}

/** 가짜 Flow 프로젝트 정보. */
const PROJECT = { title: '가짜 프로젝트', projectUrl: 'https://fake.flow.test/project/900001' };

describe('묶음 스냅숏', () => {
  it('묶음에 남은 멘션을 시간순으로, 멘션 표기는 이름만, 송신자는 중복 없이 넘기고 사용자 ID는 넘기지 않는다', () => {
    /** 스냅숏. */
    const snapshot = bundleSnapshot(
      bundle({
        mentions: [
          mention('100', { answered: true, registeredDateTime: '20261020084000' }),
          mention('101'),
          mention('102', { replyId: '801', senderName: '다른 사람', senderId: 'other@example.test', registeredDateTime: '20261020085100' }),
          mention('103', { replyId: '802', registeredDateTime: '20261020085200' }),
        ],
        newMentionCount: 2,
        directives: ['더 짧게'],
        createdAt: Date.UTC(2026, 9, 20, 0, 0),
      }),
      () => PROJECT,
    );

    expect(snapshot).toEqual({
      id: 7,
      status: 'repo-check-needed',
      group: 'awaiting-review',
      place: 'thread',
      projectTitle: '가짜 프로젝트',
      postTitle: '가짜 게시물',
      mentions: [
        { senderName: '보낸 사람', place: 'comment', at: Date.UTC(2026, 9, 19, 23, 50), text: expect.any(Array) },
        { senderName: '다른 사람', place: 'reply', at: Date.UTC(2026, 9, 19, 23, 51), text: expect.any(Array) },
        { senderName: '보낸 사람', place: 'reply', at: Date.UTC(2026, 9, 19, 23, 52), text: expect.any(Array) },
      ],
      senderNames: ['보낸 사람', '다른 사람'],
      newMentionCount: 2,
      directives: ['더 짧게'],
      lastMentionAt: Date.UTC(2026, 9, 19, 23, 52),
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
    });
    expect(snapshot.mentions[0]?.text).toEqual([
      { text: '@테스트 사용자', mention: true },
      { text: ' 질문', mention: false },
    ]);
    expect(JSON.stringify(snapshot)).not.toContain('example.test');
  });

  it('이미 답함 묶음은 빠진 멘션까지 모두 보이고 되돌릴 수 있다', () => {
    /** 스냅숏. */
    const snapshot = bundleSnapshot(
      bundle({ status: 'already-answered', processedAt: 5_000, remarkId: '-1', mentions: [mention('101', { remarkId: '-1', answered: true })] }),
      () => null,
    );

    expect([snapshot.group, snapshot.place, snapshot.mentions.length, snapshot.canRestore, snapshot.projectTitle]).toEqual([
      'processed',
      'post',
      1,
      true,
      null,
    ]);
    expect(snapshot.mentions[0]?.place).toBe('post');
  });

  it('알림 시각을 읽을 수 없으면 감지한 시각을 쓴다', () => {
    expect(bundleSnapshot(bundle({ mentions: [mention('101', { registeredDateTime: '', detectedAt: 4_000 })] }), () => null).mentions[0]?.at).toBe(4_000);
  });
});

/** 가짜 맥락. 본문, 머리 댓글(멘션)과 대댓글 둘, 다른 댓글 하나다. */
function context(): BundleContext {
  return {
    fetchedAt: 2_000,
    post: {
      title: '가짜 게시물',
      authorId: 'author@example.test',
      authorName: '글쓴이',
      registeredDateTime: '20261020080000',
      contents: '본문 @[다른 동료](other@example.test)',
      attachments: ['설계서.pdf'],
      mention: false,
    },
    targetThread: {
      id: '700',
      authorId: 'sender@example.test',
      authorName: '보낸 사람',
      registeredDateTime: '20261020085000',
      contents: '@[테스트 사용자](me@example.test) 질문',
      attachments: [],
      mention: true,
      replies: [
        { id: '800', authorId: 'colleague@example.test', authorName: '동료', registeredDateTime: '20261020085500', contents: '저도 궁금합니다', attachments: ['로그.txt'], mention: false },
        { id: '801', authorId: 'colleague@example.test', authorName: '', registeredDateTime: '', contents: '시각 없음', attachments: [], mention: false },
      ],
    },
    otherComments: [
      { id: '690', authorId: 'colleague@example.test', authorName: '동료', registeredDateTime: '20261020081000', contents: '다른 이야기', attachments: [], mention: false, replies: [] },
    ],
  };
}

describe('묶음 스냅숏: 스레드 보기', () => {
  it('댓글 스레드 묶음은 맥락의 게시물 본문과 대상 댓글 스레드를 시간순 글로 넘기고, 묶음의 멘션을 표시한다. 다른 댓글과 사용자 ID는 넘기지 않는다', () => {
    /** 스냅숏. */
    const snapshot = bundleSnapshot(bundle({ context: context() }), () => null);

    expect(snapshot.thread).toEqual([
      {
        authorName: '글쓴이',
        place: 'post',
        at: Date.UTC(2026, 9, 19, 23, 0),
        text: [
          { text: '본문 ', mention: false },
          { text: '@다른 동료', mention: true },
        ],
        attachments: ['설계서.pdf'],
        mention: false,
      },
      { authorName: '보낸 사람', place: 'comment', at: Date.UTC(2026, 9, 19, 23, 50), text: expect.any(Array), attachments: [], mention: true },
      {
        authorName: '동료',
        place: 'reply',
        at: Date.UTC(2026, 9, 19, 23, 55),
        text: [{ text: '저도 궁금합니다', mention: false }],
        attachments: ['로그.txt'],
        mention: false,
      },
      { authorName: '', place: 'reply', at: null, text: [{ text: '시각 없음', mention: false }], attachments: [], mention: false },
    ]);
    expect(JSON.stringify(snapshot)).not.toContain('example.test');
  });

  it('본문 묶음은 본문(멘션) 뒤에 다른 댓글과 그 대댓글을 넘긴다', () => {
    /** 본문 묶음의 맥락. */
    const postContext: BundleContext = {
      ...context(),
      post: { ...context().post, mention: true },
      targetThread: null,
      otherComments: [
        {
          ...context().otherComments[0]!,
          replies: [{ id: '691', authorId: 'colleague@example.test', authorName: '동료', registeredDateTime: '20261020081500', contents: '답글', attachments: [], mention: false }],
        },
      ],
    };

    /** 스냅숏. */
    const snapshot = bundleSnapshot(bundle({ remarkId: '-1', mentions: [mention('101', { remarkId: '-1' })], context: postContext }), () => null);

    expect(snapshot.thread.map((entry) => [entry.place, entry.authorName, entry.mention])).toEqual([
      ['post', '글쓴이', true],
      ['comment', '동료', false],
      ['reply', '동료', false],
    ]);
  });
});

describe('묶음 스냅숏: 초안 실행', () => {
  it('준비됨 묶음은 요구, 문장마다 근거 번호가 붙은 초안, 저장소 이름과 위치를 찾았는지가 붙은 근거, 쓴 저장소와, 초안을 만든 실행의 실행 줄을 넘긴다. 비용은 넘기지 않는다', () => {
    /** 스냅숏. */
    const snapshot = bundleSnapshot(
      bundle({
        status: 'ready',
        draft: {
          requirement: { text: '실제 서비스에서 재시도를 몇 번 하는지 알고 싶다.', summary: '재시도 횟수' },
          paragraphs: [{ sentences: [{ text: '다섯 번까지 다시 시도합니다.', evidence: [1] }, { text: '시험 환경은 세 번으로 보입니다.', evidence: [] }] }],
          evidence: [
            {
              id: 1,
              explanation: '운영 설정에서 횟수를 5로 정합니다.',
              repository: '/fake/work/billing-api',
              path: 'src/main/resources/application-prod.yml',
              startLine: 88,
              endLine: 90,
              located: true,
            },
            { id: 2, explanation: '넘기지 않은 저장소의 근거', repository: '/fake/elsewhere/other', path: 'a.ts', startLine: 1, endLine: 1, located: false },
          ],
          repositories: ['/fake/work/billing-api', '/fake/work/billing-web'],
          autoSelection: null,
          createdAt: 144_000,
        },
        runs: [run({ result: 'invalid-output', startedAt: 1_000, finishedAt: 9_000 }), run({ omittedContextItems: 3 })],
      }),
      () => PROJECT,
    );

    expect(snapshot).toMatchObject({ status: 'ready', group: 'awaiting-review', generation: null, failure: null, repoCheck: null });
    expect(snapshot.draft).toEqual({
      requirement: { text: '실제 서비스에서 재시도를 몇 번 하는지 알고 싶다.', summary: '재시도 횟수' },
      paragraphs: [
        {
          sentences: [
            { text: '다섯 번까지 다시 시도합니다.', evidence: [1], developerTerms: [] },
            { text: '시험 환경은 세 번으로 보입니다.', evidence: [], developerTerms: [] },
          ],
        },
      ],
      evidence: [
        {
          id: 1,
          explanation: '운영 설정에서 횟수를 5로 정합니다.',
          repositoryName: 'billing-api',
          path: 'src/main/resources/application-prod.yml',
          startLine: 88,
          endLine: 90,
          located: true,
          developerTerms: [],
        },
        { id: 2, explanation: '넘기지 않은 저장소의 근거', repositoryName: 'other', path: 'a.ts', startLine: 1, endLine: 1, located: false, developerTerms: [] },
      ],
      repositories: [
        { name: 'billing-api', path: '/fake/work/billing-api' },
        { name: 'billing-web', path: '/fake/work/billing-web' },
      ],
      autoSelection: null,
      mapping: 'unmapped',
      editorText: '다섯 번까지 다시 시도합니다. 시험 환경은 세 번으로 보입니다.',
      edited: false,
      canEdit: true,
      recipients: [{ name: '보낸 사람' }],
      // `@[보낸 사람](sender@example.test)` 29자와 공백 하나.
      postBodyPrefixLength: 30,
      canPost: true,
    });
    expect(snapshot.run).toEqual({ agent: 'claude-code', durationMs: 134_000, contextOmitted: true });
    expect(JSON.stringify(snapshot)).not.toContain('costUsd');
  });

  it('생성 중 묶음은 대기열의 진행을 넘기고, 대기열이 아직 모르면 기다리는 것으로 넘긴다', () => {
    /** 실행 중인 묶음의 진행. */
    const running = { status: 'running' as const, step: '파일 읽는 중: RetryConfig.kt', filesRead: 2 };

    expect(bundleSnapshot(bundle({ status: 'generating' }), () => null, () => running)).toMatchObject({ group: 'generating', generation: running, run: null });
    expect(bundleSnapshot(bundle({ status: 'generating' }), () => null, () => null).generation).toEqual({ status: 'waiting' });
    expect(bundleSnapshot(bundle({ status: 'ready' }), () => null, () => running).generation).toBeNull();
  });

  it('실패 묶음은 사유·오류 원문·마지막 단계·실패한 실행의 종류와 실패한 실행의 실행 줄을 넘기고, 저장소 확인 필요 묶음은 찾을 수 없는 폴더를 넘긴다', () => {
    /** 실패 묶음의 스냅숏. */
    const failed = bundleSnapshot(
      bundle({
        status: 'failed',
        failure: { reason: 'timed-out', detail: null, lastStep: '검색 중: retry', runKind: 'selection' },
        runs: [run({ result: 'timed-out', startedAt: 0, finishedAt: 600_000 })],
      }),
      () => null,
    );
    /** 저장소 확인 필요 묶음의 스냅숏. */
    const repoCheck = bundleSnapshot(bundle({ repoCheck: { kind: 'missing-folders', paths: ['/fake/work/gone'] } }), () => null);

    expect(failed).toMatchObject({
      group: 'failed',
      failure: { reason: 'timed-out', detail: null, lastStep: '검색 중: retry', runKind: 'selection' },
      run: { agent: 'claude-code', durationMs: 600_000, contextOmitted: false },
      draft: null,
    });
    expect(repoCheck.repoCheck).toEqual({ kind: 'missing-folders', paths: ['/fake/work/gone'], chosenByUser: false });
    // 저장소 선택 창에서 고른 구성의 폴더가 사라졌으면 연결(매핑)된 폴더가 아니라고 넘긴다.
    expect(
      bundleSnapshot(bundle({ userRepos: ['/fake/work/gone'], repoCheck: { kind: 'missing-folders', paths: ['/fake/work/gone'] } }), () => null).repoCheck,
    ).toEqual({ kind: 'missing-folders', paths: ['/fake/work/gone'], chosenByUser: true });
  });
});

describe('묶음 스냅숏: 자동 선택', () => {
  it('선택 실행이 고르지 않은 저장소 확인 필요 묶음은 선택 실행의 사유와, 에이전트가 짚은 후보(짚은 순서)와 작업 폴더의 나머지 후보를 나눠 넘긴다. 후보가 없었으면 그 사유를 넘긴다', () => {
    /** 작업 폴더의 후보. */
    const candidates = [
      { name: 'billing-api', path: '/fake/work/billing-api' },
      { name: 'team/billing-batch', path: '/fake/work/team/billing-batch' },
      { name: 'team/billing-web', path: '/fake/work/team/billing-web' },
    ];
    /** 선택 실행이 확신하지 못한 묶음의 스냅숏. */
    const unsure = bundleSnapshot(
      bundle({
        repoCheck: {
          kind: 'unsure',
          reason: '재시도 설정이 화면과 서버 양쪽에 있어 어느 쪽인지 알 수 없습니다.',
          candidates,
          picked: ['/fake/work/team/billing-web', '/fake/work/billing-api'],
        },
      }),
      () => null,
    );

    expect(unsure.repoCheck).toEqual({
      kind: 'unsure',
      reason: '재시도 설정이 화면과 서버 양쪽에 있어 어느 쪽인지 알 수 없습니다.',
      picked: [
        { name: 'team/billing-web', path: '/fake/work/team/billing-web' },
        { name: 'billing-api', path: '/fake/work/billing-api' },
      ],
      others: [{ name: 'team/billing-batch', path: '/fake/work/team/billing-batch' }],
    });
    expect(bundleSnapshot(bundle({ repoCheck: { kind: 'unrelated', reason: '', candidates, picked: [] } }), () => null).repoCheck).toMatchObject({
      picked: [],
      others: candidates,
    });
    expect(bundleSnapshot(bundle({ repoCheck: { kind: 'no-candidates' } }), () => null).repoCheck).toEqual({ kind: 'no-candidates' });
  });

  it('선택 실행만 돌고 저장소 확인 필요가 된 묶음은 그 선택 실행의 실행 줄을 넘기고, 매핑된 폴더가 사라져 실행하지 않은 묶음은 실행 줄이 없다', () => {
    /** 선택 실행이 확신하지 못한 묶음의 스냅숏. */
    const unsure = bundleSnapshot(
      bundle({
        repoCheck: { kind: 'unsure', reason: '모르겠습니다.', candidates: [], picked: [] },
        runs: [run({ kind: 'selection', startedAt: 0, finishedAt: 62_000 })],
      }),
      () => null,
    );

    expect(unsure.run).toEqual({ agent: 'claude-code', durationMs: 62_000, contextOmitted: false });
    expect(bundleSnapshot(bundle({ repoCheck: { kind: 'missing-folders', paths: ['/fake/work/gone'] } }), () => null).run).toBeNull();
  });

  it('자동 선택으로 만든 준비됨 묶음의 초안은 자동 선택의 내력(선택 실행의 이유, 후보가 하나였음)을 넘긴다', () => {
    /** 초안 하나. */
    const draft = {
      requirement: { text: '요구', summary: '요약' },
      paragraphs: [{ sentences: [{ text: '문장입니다.', evidence: [] }] }],
      evidence: [],
      repositories: ['/fake/work/billing-api'],
      createdAt: 144_000,
    };

    expect(
      bundleSnapshot(bundle({ status: 'ready', draft: { ...draft, autoSelection: { kind: 'chosen', reason: '서버 설정을 묻고 있습니다.' } } }), () => null).draft
        ?.autoSelection,
    ).toEqual({ kind: 'chosen', reason: '서버 설정을 묻고 있습니다.' });
    expect(bundleSnapshot(bundle({ status: 'ready', draft: { ...draft, autoSelection: { kind: 'single-candidate' } } }), () => null).draft?.autoSelection).toEqual({
      kind: 'single-candidate',
    });
  });
});

describe('저장소 영역의 연결 버튼과 저장소 선택 창', () => {
  /** 초안 하나. */
  const draft = {
    requirement: { text: '요구', summary: '요약' },
    paragraphs: [{ sentences: [{ text: '문장입니다.', evidence: [] }] }],
    evidence: [],
    repositories: ['/fake/work/web', '/fake/work/api'],
    autoSelection: null,
    createdAt: 144_000,
  };

  it('초안의 구성을 그 Flow 프로젝트의 저장소 매핑과 견준 결과를 넘긴다. 연결 버튼 문구가 이것으로 정해진다', () => {
    /** 견준 구성. */
    const asked: [string, string[]][] = [];

    /** 넘긴 초안. */
    const snapshot = bundleSnapshot(bundle({ status: 'ready', draft }), () => null, undefined, (projectId, repos) => {
      asked.push([projectId, [...repos]]);
      return 'different';
    }).draft;

    expect(snapshot?.mapping).toBe('different');
    expect(asked).toEqual([['900001', ['/fake/work/web', '/fake/work/api']]]);
    expect(bundleSnapshot(bundle({ status: 'ready', draft }), () => null).draft?.mapping).toBe('unmapped');
  });

  it('열린 저장소 선택 창의 후보와 연결 버튼 상태를 넘기고, 닫혀 있으면 null이다', () => {
    /** 열린 창. */
    const picker = {
      bundleId: 7,
      status: 'ready' as const,
      choices: [{ name: 'web', path: '/fake/work/web', group: 'current' as const, checked: true }],
      mapping: 'same' as const,
    };
    /** 창 하나의 영역 펼침 상태. */
    const sections = { original: true, requirement: true, draft: true, evidence: true, repository: true, progress: true };

    expect(reviewSnapshot([], { compact: sections, expanded: sections }, () => null, () => null, () => 'unmapped', picker).repoPicker).toEqual(picker);
    expect(reviewSnapshot([], { compact: sections, expanded: sections }, () => null, () => null, () => 'unmapped', null).repoPicker).toBeNull();
  });
});

describe('Flow에서 열기 주소', () => {
  it('게시물의 connectUrl을 먼저 쓰고, 없으면 Flow 프로젝트의 projectUrl을 쓴다', () => {
    expect(flowUrlOf(bundle(), () => PROJECT)).toBe('https://fake.flow.test/post/90000011');
    expect(flowUrlOf(bundle({ connectUrl: null }), () => PROJECT)).toBe('https://fake.flow.test/project/900001');
    expect(flowUrlOf(bundle({ connectUrl: null }), () => null)).toBeNull();
  });

  it('https 주소가 아니면 열지 않는다', () => {
    expect(flowUrlOf(bundle({ connectUrl: 'javascript:alert(1)' }), () => null)).toBeNull();
    expect(flowUrlOf(bundle({ connectUrl: 'http://fake.flow.test/post/1' }), () => ({ ...PROJECT, projectUrl: 'file:///etc/passwd' }))).toBeNull();
    expect(flowUrlOf(bundle({ connectUrl: '주소 아님' }), () => PROJECT)).toBe('https://fake.flow.test/project/900001');
    expect(bundleSnapshot(bundle({ connectUrl: 'javascript:alert(1)' }), () => null).canOpenInFlow).toBe(false);
  });
});

describe('초안 편집기와 받는 사람', () => {
  /** 두 문단짜리 초안. */
  const draft = {
    requirement: { text: '요구', summary: '요약' },
    paragraphs: [{ sentences: [{ text: '첫 문장입니다.', evidence: [1] }, { text: '둘째 문장입니다.', evidence: [] }] }, { sentences: [{ text: '새 문단입니다.', evidence: [] }] }],
    evidence: [],
    repositories: ['/fake/work/web'],
    autoSelection: null,
    createdAt: 144_000,
  };
  /** 송신자 둘의 멘션. 송신자는 두 번 멘션했다. */
  const mentions = [
    mention('101'),
    mention('102', { replyId: '801', senderId: 'other@example.test', senderName: '다른 사람', registeredDateTime: '20261020085100' }),
    mention('103', { replyId: '802', registeredDateTime: '20261020085200' }),
  ];

  it('편집하지 않은 초안은 원래 초안에서 만든 편집기 텍스트를 넘기고, 받는 사람은 이름만 처음 멘션한 순서로 넘긴다. 사용자 ID는 넘기지 않는다', () => {
    /** 넘긴 초안. */
    const snapshot = bundleSnapshot(bundle({ status: 'ready', draft, mentions }), () => null).draft;

    expect(snapshot).toMatchObject({
      editorText: '첫 문장입니다. 둘째 문장입니다.\n\n새 문단입니다.',
      edited: false,
      canEdit: true,
      recipients: [{ name: '보낸 사람' }, { name: '다른 사람' }],
      // `@[보낸 사람](sender@example.test)` 29자, `@[다른 사람](other@example.test)` 28자와 공백 둘.
      postBodyPrefixLength: 59,
    });
    expect(JSON.stringify(snapshot)).not.toContain('@example.test');
  });

  it('편집한 초안은 편집본을 넘기고 편집했다고 알린다', () => {
    /** 넘긴 초안. */
    const snapshot = bundleSnapshot(bundle({ status: 'ready', draft, mentions, editedText: '고친 초안입니다.' }), () => null).draft;

    expect(snapshot).toMatchObject({ editorText: '고친 초안입니다.', edited: true });
  });

  it('뺀 사람은 받는 사람에 넣지 않고, 모두 빼면 받는 사람이 없어 게시 본문 앞부분도 없다', () => {
    expect(
      bundleSnapshot(bundle({ status: 'ready', draft, mentions, removedRecipients: ['sender@example.test'] }), () => null).draft,
    ).toMatchObject({ recipients: [{ name: '다른 사람' }], postBodyPrefixLength: 29 });
    expect(
      bundleSnapshot(bundle({ status: 'ready', draft, mentions, removedRecipients: ['sender@example.test', 'other@example.test'] }), () => null).draft,
    ).toMatchObject({ recipients: [], postBodyPrefixLength: 0 });
  });

  it('준비됨이 아닌 묶음의 초안은 고칠 수 없다고 넘긴다', () => {
    /** 무시한 묶음의 초안. */
    const snapshot = bundleSnapshot(bundle({ status: 'ignored', processedAt: 2_000, draft, mentions, editedText: '고친 초안입니다.' }), () => null).draft;

    expect(snapshot).toMatchObject({ editorText: '고친 초안입니다.', edited: true, canEdit: false });
  });
});

describe('게시', () => {
  /** 한 문단짜리 초안. */
  const draft = {
    requirement: { text: '요구', summary: '요약' },
    paragraphs: [{ sentences: [{ text: '답입니다.', evidence: [] }] }],
    evidence: [],
    repositories: ['/fake/work/web'],
    autoSelection: null,
    createdAt: 144_000,
  };
  /** 송신자 한 명의 멘션. 받는 사람 표기 `@[보낸 사람](sender@example.test)`는 29자다. */
  const mentions = [mention('101')];

  it('준비됨 묶음은 게시할 수 있고, 편집기 텍스트가 비었거나 받는 사람 표기를 포함한 게시 본문이 4,000자를 넘으면 게시할 수 없다', () => {
    /** 편집본으로 만든 준비됨 묶음의 초안. */
    const draftOf = (editedText: string | null) => bundleSnapshot(bundle({ status: 'ready', draft, mentions, editedText }), () => null).draft;

    expect(draftOf(null)?.canPost).toBe(true);
    expect(draftOf('  \n ')?.canPost).toBe(false);
    // 받는 사람 표기 29자와 공백 1자 뒤의 편집기 텍스트 3,970자가 꼭 4,000자다.
    expect(draftOf('가'.repeat(3_970))?.canPost).toBe(true);
    expect(draftOf('가'.repeat(3_971))?.canPost).toBe(false);
  });

  it('카운트다운 중인 게시 중 묶음은 게시 요청을 보낼 시각을 넘기고, 검토 대기에 남으며 고치거나 다시 게시할 수 없다', () => {
    /** 카운트다운 중인 묶음의 스냅숏. */
    const snapshot = bundleSnapshot(bundle({ id: 7, status: 'posting', draft, mentions }), () => null, undefined, undefined, (bundleId) =>
      bundleId === 7 ? 15_000 : null,
    );

    expect(snapshot).toMatchObject({ status: 'posting', group: 'awaiting-review', posting: { phase: 'countdown', endsAt: 15_000 } });
    expect(snapshot.draft).toMatchObject({ canEdit: false, canPost: false });
  });

  it('게시 요청을 보낸 게시 중 묶음은 결과를 기다린다고 넘긴다', () => {
    /** 게시 요청을 보낸 묶음의 스냅숏. */
    const snapshot = bundleSnapshot(bundle({ status: 'posting', draft, mentions, posting: { body: '답입니다.', sentAt: 15_000, postedId: null } }), () => null);

    expect(snapshot.posting).toEqual({ phase: 'sending' });
  });

  it('게시됨 묶음은 처리됨이고 되돌릴 수 없으며, 게시 중이 아니면 게시 단계가 없다', () => {
    /** 게시됨 묶음의 스냅숏. */
    const snapshot = bundleSnapshot(
      bundle({ status: 'posted', processedAt: 20_000, draft, mentions, posting: { body: '답입니다.', sentAt: 15_000, postedId: '950000001' } }),
      () => null,
    );

    expect(snapshot).toMatchObject({ status: 'posted', group: 'processed', canRestore: false, posting: null });
    expect(snapshot.draft?.canPost).toBe(false);
  });

  it('렌더러가 쓰는 게시 본문 상한은 core의 상한과 같다', () => {
    expect(POST_BODY_CHAR_LIMIT).toBe(4_000);
    expect(CORE_POST_BODY_CHAR_LIMIT).toBe(4_000);
  });
});

describe('문체 검사', () => {
  it('초안 문장과 근거 설명마다 개발자 용어일 수 있는 말을 넘기고, 멘션 원문·게시물 제목·스레드에 나온 말은 뺀다', () => {
    /** 송신자가 retryCount를, 대댓글의 동료가 RetryConfig.kt를 쓴 맥락. */
    const threadContext: BundleContext = {
      ...context(),
      targetThread: { ...context().targetThread!, replies: [{ ...context().targetThread!.replies[0]!, contents: 'RetryConfig.kt도 봐 주세요' }] },
    };
    /** 스냅숏의 초안. */
    const snapshot = bundleSnapshot(
      bundle({
        status: 'ready',
        postTitle: 'billing.retry 설정 문의',
        mentions: [mention('101', { text: '@[테스트 사용자](me@example.test) retryCount가 몇인가요?' })],
        context: threadContext,
        draft: {
          requirement: { text: '요구', summary: '요약' },
          paragraphs: [
            {
              sentences: [
                { text: 'retryCount는 maxAttempts로 정합니다.', evidence: [1] },
                { text: 'RetryConfig.kt와 billing.retry를 보면 됩니다.', evidence: [] },
              ],
            },
          ],
          evidence: [{ id: 1, explanation: 'application-prod.yml에서 정합니다.', repository: '/fake/work/api', path: 'a.yml', startLine: 1, endLine: 1, located: true }],
          repositories: ['/fake/work/api'],
          autoSelection: null,
          createdAt: 144_000,
        },
      }),
      () => null,
    ).draft;

    expect(snapshot?.paragraphs[0]?.sentences.map((sentence) => sentence.developerTerms)).toEqual([['maxAttempts'], []]);
    expect(snapshot?.evidence[0]?.developerTerms).toEqual(['application-prod.yml']);
  });
});
