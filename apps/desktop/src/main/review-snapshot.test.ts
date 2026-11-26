import { describe, expect, it } from 'vitest';
import type { ManualCheckState } from '../core/manual-check/manual-check-session';
import type { BundledMention, MentionBundle } from '../core/bundles/mention-bundle';
import type { RunRecord } from '../core/drafts/draft';
import type { BundleContext } from '../core/flow/bundle-context';
import { POST_BODY_CHAR_LIMIT as CORE_POST_BODY_CHAR_LIMIT } from '../core/drafts/post-body';
import { POST_BODY_CHAR_LIMIT } from '../shared/ipc';
import type { SentryDiagnosis } from '../core/sentry/sentry-diagnosis';
import { bundleSnapshot, diagnosisSnapshots, flowUrlOf, manualCheckSnapshot, reviewSnapshot } from './review-snapshot';

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
    gone: false,
    goneExcluded: false,
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
    watchedContext: null,
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
    quitDuringCountdown: false,
    manual: false,
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
/** 저장소 매핑이 있는 프로젝트의 매핑 조회. 초안의 구성이 매핑과 같다고 답한다. */
const MAPPED = () => 'same' as const;
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
        { senderName: '보낸 사람', place: 'comment', at: Date.UTC(2026, 9, 19, 23, 50), text: expect.any(Array), edited: false },
        { senderName: '다른 사람', place: 'reply', at: Date.UTC(2026, 9, 19, 23, 51), text: expect.any(Array), edited: false },
        { senderName: '보낸 사람', place: 'reply', at: Date.UTC(2026, 9, 19, 23, 52), text: expect.any(Array), edited: false },
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
      postFailure: null,
      quitDuringCountdown: false,
      changes: { newWritingCount: 0, edited: false, goneMentionCount: 0 },
      manual: false,
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

describe('묶음 스냅숏: 준비된 뒤의 변화', () => {
  /** 가짜 초안. */
  const draft = {
    requirement: { text: '질문에 답해 달라는 요구', summary: '질문' },
    paragraphs: [{ sentences: [{ text: '답입니다.', evidence: [] }] }],
    evidence: [],
    repositories: ['/fake/work/repo'],
    autoSelection: null,
    createdAt: 1_000,
  };
  /** 변화 감시가 조회한 내용. 머리 댓글이 수정되었고 대댓글 802가 새로 달렸다. */
  const watched: BundleContext = {
    ...context(),
    fetchedAt: 3_000,
    targetThread: {
      ...context().targetThread!,
      contents: '@[테스트 사용자](me@example.test) 질문을 고쳤습니다',
      replies: [
        ...context().targetThread!.replies,
        { id: '802', authorId: 'sender@example.test', authorName: '보낸 사람', registeredDateTime: '20261020090100', contents: '운영 환경 얘기예요', attachments: [], mention: false },
      ],
    },
  };

  it('비교 기준과 감시 내용을 견준 새 글 수·원문 수정·사라진 멘션 수를 넘기고, 원문 영역은 지금 내용에 "새 글"·"수정됨"을 표시한다', () => {
    /** 스냅숏. 대댓글 803의 멘션은 사라졌다. */
    const snapshot = bundleSnapshot(
      bundle({
        status: 'ready',
        draft,
        context: context(),
        watchedContext: watched,
        mentions: [mention('101'), mention('102', { replyId: '803', gone: true })],
      }),
      () => null,
    );

    expect(snapshot.changes).toEqual({ newWritingCount: 1, edited: true, goneMentionCount: 1 });
    expect(snapshot.mentions).toEqual([
      {
        senderName: '보낸 사람',
        place: 'comment',
        at: Date.UTC(2026, 9, 19, 23, 50),
        text: [
          { text: '@테스트 사용자', mention: true },
          { text: ' 질문을 고쳤습니다', mention: false },
        ],
        edited: true,
      },
    ]);
    expect(snapshot.thread.map((entry) => [entry.place, entry.authorName, entry.change])).toEqual([
      ['post', '글쓴이', null],
      ['comment', '보낸 사람', 'edited'],
      ['reply', '동료', null],
      ['reply', '', null],
      ['reply', '보낸 사람', 'new'],
    ]);
  });

  it('감시 내용이 없으면 변화가 없고 원문은 감지 때 받은 글이다', () => {
    /** 스냅숏. */
    const snapshot = bundleSnapshot(bundle({ status: 'ready', draft, context: context(), mentions: [mention('101')] }), () => null);

    expect(snapshot.changes).toEqual({ newWritingCount: 0, edited: false, goneMentionCount: 0 });
    expect(snapshot.mentions.map((item) => item.edited)).toEqual([false]);
    expect(snapshot.thread.every((entry) => entry.change === null)).toBe(true);
  });

  it('원문 사라짐 묶음은 처리됨이고 되돌릴 수 있으며, 원문 영역에는 사라진 멘션을 보인다', () => {
    /** 스냅숏. */
    const snapshot = bundleSnapshot(bundle({ status: 'source-gone', processedAt: 5_000, draft, mentions: [mention('101', { gone: true })] }), () => null);

    expect(snapshot).toMatchObject({ status: 'source-gone', group: 'processed', canRestore: true });
    expect(snapshot.mentions).toHaveLength(1);
    expect(snapshot.draft?.canPost).toBe(false);
  });
});

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
        change: null,
      },
      { authorName: '보낸 사람', place: 'comment', at: Date.UTC(2026, 9, 19, 23, 50), text: expect.any(Array), attachments: [], mention: true, change: null },
      {
        authorName: '동료',
        place: 'reply',
        at: Date.UTC(2026, 9, 19, 23, 55),
        text: [{ text: '저도 궁금합니다', mention: false }],
        attachments: ['로그.txt'],
        mention: false,
        change: null,
      },
      { authorName: '', place: 'reply', at: null, text: [{ text: '시각 없음', mention: false }], attachments: [], mention: false, change: null },
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
          paragraphs: [{ sentences: [{ text: '다섯 번까지 다시 시도합니다.', evidence: [1] }, { text: '테스트 환경은 세 번으로 보입니다.', evidence: [] }] }],
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
      undefined,
      MAPPED,
    );

    expect(snapshot).toMatchObject({ status: 'ready', group: 'awaiting-review', generation: null, failure: null, repoCheck: null });
    expect(snapshot.draft).toEqual({
      requirement: { text: '실제 서비스에서 재시도를 몇 번 하는지 알고 싶다.', summary: '재시도 횟수' },
      paragraphs: [
        {
          sentences: [
            { text: '다섯 번까지 다시 시도합니다.', evidence: [1], developerTerms: [] },
            { text: '테스트 환경은 세 번으로 보입니다.', evidence: [], developerTerms: [] },
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
      mapping: 'same',
      editorText: '다섯 번까지 다시 시도합니다. 테스트 환경은 세 번으로 보입니다.',
      edited: false,
      canEdit: true,
      canRegenerate: true,
      repoUndetermined: false,
      recipients: [{ name: '보낸 사람' }],
      // `@[보낸 사람](sender@example.test)` 29자와 공백 하나.
      postBodyPrefixLength: 30,
      canPost: true,
    });
    expect(snapshot.run).toEqual({ kind: 'draft', agent: 'claude-code', durationMs: 134_000, contextOmitted: true });
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
      run: { kind: 'draft', agent: 'claude-code', durationMs: 600_000, contextOmitted: false },
      draft: null,
    });
    expect(repoCheck.repoCheck).toEqual({ kind: 'missing-folders', paths: ['/fake/work/gone'], chosenByUser: false, waitingCount: 1 });
    // 저장소 선택 창에서 고른 구성의 폴더가 사라졌으면 연결(매핑)된 폴더가 아니라고 넘긴다.
    expect(
      bundleSnapshot(bundle({ userRepos: ['/fake/work/gone'], repoCheck: { kind: 'missing-folders', paths: ['/fake/work/gone'] } }), () => null).repoCheck,
    ).toEqual({ kind: 'missing-folders', paths: ['/fake/work/gone'], chosenByUser: true, waitingCount: 1 });
  });
});

describe('묶음 스냅숏: 저장소 대기', () => {
  /** 저장소 하나로 만든 초안. */
  const draft = {
    requirement: { text: '재시도 횟수를 알고 싶다.', summary: '재시도 횟수' },
    paragraphs: [{ sentences: [{ text: '다섯 번까지 다시 시도합니다.', evidence: [] }] }],
    evidence: [],
    repositories: ['/fake/work/web'],
    autoSelection: null,
    createdAt: 144_000,
  };

  it('매핑도 고른 저장소도 없어 기다리는 묶음은 저장소 매핑 필요 사유를 넘기고, 폴더가 없으면 저장소 확인 필요 사유를 넘긴다', () => {
    expect(bundleSnapshot(bundle({ status: 'repo-check-needed', repoCheck: { kind: 'unmapped' } }), () => null).repoCheck).toEqual({ kind: 'unmapped', waitingCount: 1 });
    expect(bundleSnapshot(bundle({ status: 'repo-check-needed', repoCheck: { kind: 'missing-folders', paths: ['/fake/gone'] } }), () => null).repoCheck).toMatchObject({
      kind: 'missing-folders',
    });
  });

  it('고른 저장소도 저장소 매핑도 없는 초안은 저장소가 정해지지 않은 초안이라 다시 만들 수 없다고 넘긴다. 매핑이 있거나 고른 저장소가 있으면 아니다', () => {
    /** 저장소가 정해지지 않은 초안의 스냅숏. */
    const undetermined = bundleSnapshot(bundle({ status: 'ready', draft }), () => null, undefined, () => 'unmapped').draft;
    /** 매핑이 있는 초안의 스냅숏. */
    const mapped = bundleSnapshot(bundle({ status: 'ready', draft }), () => null, undefined, MAPPED).draft;
    /** 고른 저장소로 만든 초안의 스냅숏. 매핑이 없어도 저장소가 정해져 있다. */
    const chosen = bundleSnapshot(bundle({ status: 'ready', draft, userRepos: ['/fake/work/web'] }), () => null, undefined, () => 'unmapped').draft;

    /** 무시한 묶음의 스냅숏. 처리됨 묶음은 다시 만들 수 없다는 안내를 따로 하지 않는다. */
    const ignored = bundleSnapshot(bundle({ status: 'ignored', processedAt: 20_000, draft }), () => null, undefined, () => 'unmapped').draft;

    expect(ignored?.repoUndetermined).toBe(false);
    expect(undetermined).toMatchObject({ repoUndetermined: true, canRegenerate: false, canPost: true, canEdit: true });
    expect(mapped).toMatchObject({ repoUndetermined: false, canRegenerate: true });
    expect(chosen).toMatchObject({ repoUndetermined: false, canRegenerate: true });
  });
});

describe('묶음 스냅숏: 저장소 대기와 폐지된 선택 실행', () => {
  it('저장소 대기 묶음은 저장소 매핑 필요와 저장소 확인 필요의 사유만 넘긴다. 고른 구성이 있으면 그 구성의 폴더라고 알린다', () => {
    expect(bundleSnapshot(bundle({ repoCheck: { kind: 'unmapped' } }), () => null).repoCheck).toEqual({ kind: 'unmapped', waitingCount: 1 });
    expect(bundleSnapshot(bundle({ repoCheck: { kind: 'missing-folders', paths: ['/fake/work/gone'] } }), () => null).repoCheck).toEqual({
      kind: 'missing-folders',
      paths: ['/fake/work/gone'],
      chosenByUser: false,
      waitingCount: 1,
    });
    expect(
      bundleSnapshot(bundle({ repoCheck: { kind: 'missing-folders', paths: ['/fake/work/gone'] }, userRepos: ['/fake/work/gone'] }), () => null).repoCheck,
    ).toMatchObject({ chosenByUser: true });
  });

  it('실패한 묶음의 마지막 실행이 과거의 저장소 선택 실행이면 실행 줄이 선택 실행으로 읽히고, 초안 실행이면 초안 실행이다', () => {
    /** 선택 실행에서 멈춘 실패 묶음의 스냅숏. */
    const selection = bundleSnapshot(
      bundle({ status: 'failed', failure: { reason: 'timed-out', detail: null, lastStep: null, runKind: 'selection' }, runs: [run({ kind: 'selection', startedAt: 0, finishedAt: 62_000 })] }),
      () => null,
    );
    /** 초안 실행에서 멈춘 실패 묶음의 스냅숏. */
    const draft = bundleSnapshot(
      bundle({ status: 'failed', failure: { reason: 'timed-out', detail: null, lastStep: null, runKind: 'draft' }, runs: [run({ kind: 'draft', startedAt: 0, finishedAt: 62_000 })] }),
      () => null,
    );

    expect(selection.run).toEqual({ kind: 'selection', agent: 'claude-code', durationMs: 62_000, contextOmitted: false });
    expect(draft.run).toEqual({ kind: 'draft', agent: 'claude-code', durationMs: 62_000, contextOmitted: false });
  });

  it('매핑된 폴더가 사라져 실행하지 않은 묶음은 실행 줄이 없다', () => {
    expect(bundleSnapshot(bundle({ repoCheck: { kind: 'missing-folders', paths: ['/fake/work/gone'] } }), () => null).run).toBeNull();
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
      choices: [{ name: 'web', path: '/fake/work/web', group: 'current' as const, checked: true }],
      mapping: 'same' as const,
    };
    /** 창 하나의 영역 펼침 상태. */
    const sections = { original: true, requirement: true, draft: true, evidence: true, repository: true, progress: true };

    expect(reviewSnapshot([], [], { compact: sections, expanded: sections }, () => null, () => null, () => 'unmapped', picker, () => null).repoPicker).toEqual(picker);
    expect(reviewSnapshot([], [], { compact: sections, expanded: sections }, () => null, () => null, () => 'unmapped', null, () => null).repoPicker).toBeNull();
  });
});

describe('묶음 스냅숏: 저장소 대기 건수', () => {
  it('같은 프로젝트에서 같은 사유로 기다리는 묶음 수를 바닥 줄 글에 쓰도록 넘긴다. 사유나 프로젝트가 다르면 따로 센다', () => {
    /** 영역 펼침 상태. */
    const sections = { original: true, requirement: true, draft: true, evidence: true, repository: true, progress: true };
    /** 같은 프로젝트의 저장소 매핑 필요 묶음 둘, 다른 프로젝트의 하나, 같은 프로젝트의 저장소 확인 필요 하나. */
    const bundles = [
      bundle({ id: 1, repoCheck: { kind: 'unmapped' } }),
      bundle({ id: 2, repoCheck: { kind: 'unmapped' } }),
      bundle({ id: 3, projectId: '900002', repoCheck: { kind: 'unmapped' } }),
      bundle({ id: 4, repoCheck: { kind: 'missing-folders', paths: ['/fake/gone'] } }),
    ];

    /** 건수만 모은 값. */
    const counts = reviewSnapshot(bundles, [], { compact: sections, expanded: sections }, () => null, () => null, () => 'unmapped', null, () => null).bundles.map((item) => item.repoCheck?.waitingCount);

    expect(counts).toEqual([2, 2, 1, 1]);
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
    const snapshot = bundleSnapshot(bundle({ status: 'posting', draft, mentions, posting: { body: '답입니다.', sentAt: 15_000, postedId: null, failure: null, answeredMentions: [] } }), () => null);

    expect(snapshot.posting).toEqual({ phase: 'sending' });
  });

  it('게시됨 묶음은 처리됨이고 되돌릴 수 없으며, 게시 중이 아니면 게시 단계가 없다', () => {
    /** 게시됨 묶음의 스냅숏. */
    const snapshot = bundleSnapshot(
      bundle({ status: 'posted', processedAt: 20_000, draft, mentions, posting: { body: '답입니다.', sentAt: 15_000, postedId: '950000001', failure: null, answeredMentions: [] } }),
      () => null,
    );

    expect(snapshot).toMatchObject({ status: 'posted', group: 'processed', canRestore: false, posting: null });
    expect(snapshot.draft?.canPost).toBe(false);
  });

  it('게시 실패 묶음은 실패 목록에 들고 사유를 넘기며, 편집하고 다시 게시할 수 있지만 다시 만들 수는 없다', () => {
    /** 게시 실패 묶음의 스냅숏. */
    const snapshot = bundleSnapshot(
      bundle({ status: 'post-failed', draft, mentions, editedText: '고친 답입니다.', posting: { body: '답입니다.', sentAt: 15_000, postedId: null, failure: 'forbidden', answeredMentions: [] } }),
      () => null,
    );

    expect(snapshot).toMatchObject({ status: 'post-failed', group: 'failed', postFailure: 'forbidden', posting: null, canRestore: false });
    expect(snapshot.draft).toMatchObject({ editorText: '고친 답입니다.', canEdit: true, canRegenerate: false, canPost: true });
  });

  it('게시 실패가 아니면 게시 실패의 사유를 넘기지 않고, 준비됨 묶음은 다시 만들 수 있다', () => {
    /** 무시한 게시 실패 묶음. 게시 기록에 사유가 남아 있다. */
    const ignored = bundleSnapshot(
      bundle({ status: 'ignored', processedAt: 20_000, draft, mentions, posting: { body: '답입니다.', sentAt: 15_000, postedId: null, failure: 'gone', answeredMentions: [] } }),
      () => null,
    );

    expect(ignored.postFailure).toBeNull();
    expect(bundleSnapshot(bundle({ status: 'ready', draft, mentions }), () => null, undefined, MAPPED).draft?.canRegenerate).toBe(true);
  });

  it('카운트다운 중에 앱이 꺼져 준비됨으로 돌아온 묶음은 그렇다고 넘기고 게시할 수 있다. 준비됨이 아니게 되면 넘기지 않는다', () => {
    /** 다시 켤 때 준비됨으로 돌아온 묶음의 스냅숏. */
    const returned = bundleSnapshot(bundle({ status: 'ready', draft, mentions, quitDuringCountdown: true }), () => null);

    expect(returned).toMatchObject({ status: 'ready', quitDuringCountdown: true, posting: null });
    expect(returned.draft?.canPost).toBe(true);
    expect(bundleSnapshot(bundle({ status: 'ignored', processedAt: 20_000, draft, mentions, quitDuringCountdown: true }), () => null).quitDuringCountdown).toBe(false);
    expect(bundleSnapshot(bundle({ status: 'ready', draft, mentions }), () => null).quitDuringCountdown).toBe(false);
  });

  it('응답을 받기 전에 앱이 꺼져 게시하지 못한 게시 실패는 그 사유를 넘긴다', () => {
    /** 다시 켠 뒤 올라간 글을 찾지 못한 묶음의 스냅숏. */
    const snapshot = bundleSnapshot(
      bundle({ status: 'post-failed', draft, mentions, posting: { body: '답입니다.', sentAt: 15_000, postedId: null, failure: 'app-quit', answeredMentions: [] } }),
      () => null,
    );

    expect(snapshot.postFailure).toBe('app-quit');
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

describe('최근 멘션 확인 스냅숏', () => {
  /** 불러온 확인 시트. 첫 줄 앞에 빈 줄이 있는 멘션 둘이다. 첫째는 답했고, 둘째는 답하지 않았다. */
  const loaded: ManualCheckState = {
    sheet: {
      window: 'popover',
      tab: 'mentions',
      assignments: { status: 'idle' },
      mentions: {
        status: 'loaded',
        candidates: [
        {
          mention: mention('102', { text: '\n  @[테스트 사용자](me@example.test) 배포 언제 되나요?\n둘째 줄' }),
          postTitle: '가짜 게시물',
          connectUrl: null,
          answered: true,
          projectTitle: '가짜 프로젝트',
        },
        { mention: mention('101', { remarkId: '90000099' }), postTitle: '가짜 게시물', connectUrl: null, answered: false, projectTitle: null },
        ],
        hasMore: true,
        loadingMore: false,
        moreFailure: null,
      },
    },
  };
  /** 장소마다 기록이 없다고 답하는 조회. */
  const none = () => ({ kind: 'none' as const });

  it('줄은 송신자, Flow 프로젝트, 첫 줄, 시각만 넘기고 사용자 ID와 이어 불러올 커서는 넘기지 않는다', () => {
    /** 만든 스냅숏. */
    const snapshot = manualCheckSnapshot(loaded, true, none, none);

    expect(snapshot.canOpen).toBe(true);
    expect(snapshot.sheet).toMatchObject({ window: 'popover', tab: 'mentions', status: 'loaded', hasMore: true, loadingMore: false, moreFailure: null });
    expect(snapshot.sheet?.status === 'loaded' && snapshot.sheet.rows[0]).toEqual({
      kind: 'mention',
      alarmId: '102',
      senderName: '보낸 사람',
      projectTitle: '가짜 프로젝트',
      firstLine: '@테스트 사용자 배포 언제 되나요?',
      at: Date.UTC(2026, 9, 19, 23, 50),
      tags: [{ kind: 'answered' }],
      missReasons: [],
    });
    expect(JSON.stringify(snapshot)).not.toContain('example.test');
    expect(JSON.stringify(snapshot)).not.toContain('decidedLocations');
  });

  it('줄 태그는 답함, 이미 있는 묶음과 그 상태, 처리됨(최소 기록)이 함께 붙는다', () => {
    /** 줄마다 찾은 기존 기록. 첫째는 묶음, 둘째는 최소 기록이다. */
    const snapshot = manualCheckSnapshot(loaded, true, (location) => (location.alarmId === '102' ? { kind: 'bundle', bundleId: 7, status: 'posted' } : { kind: 'record' }), none);
    /** 줄. */
    const rows = snapshot.sheet?.status === 'loaded' ? snapshot.sheet.rows : [];

    expect(rows[0]?.tags).toEqual([{ kind: 'answered' }, { kind: 'bundle', bundleId: 7, status: 'posted' }]);
    expect(rows[1]?.tags).toEqual([{ kind: 'archived' }]);
  });

  it('닫혀 있거나 불러오는 중이거나 실패한 시트는 그대로 넘기고, 열 수 있는지는 따로 넘긴다', () => {
    expect(manualCheckSnapshot({ sheet: null }, false, none, none)).toEqual({ canOpen: false, sheet: null });
    expect(manualCheckSnapshot({ sheet: { window: 'settings', tab: 'mentions', assignments: { status: 'idle' }, mentions: { status: 'loading' } } }, true, none, none).sheet).toEqual({
      window: 'settings',
      tab: 'mentions',
      status: 'loading',
    });
    expect(
      manualCheckSnapshot({ sheet: { window: 'settings', tab: 'mentions', assignments: { status: 'idle' }, mentions: { status: 'failed', reason: 'rate-limited' } } }, true, none, none).sheet,
    ).toEqual({ window: 'settings', tab: 'mentions', status: 'failed', reason: 'rate-limited' });
  });

  it('지금 보는 탭의 상태만 넘기고, 담당 업무 줄은 작성자·프로젝트·업무 제목·알림 시각과 상태 태그, 감지에서 빠진 이유를 넘긴다', () => {
    /** 담당 업무 탭을 보는 시트. 멘션 탭은 실패했어도 담당 업무 탭만 보인다. */
    const state: ManualCheckState = {
      sheet: {
        window: 'popover',
        tab: 'assignments',
        mentions: { status: 'failed', reason: 'network' },
        assignments: {
          status: 'loaded',
          candidates: [
            {
              alarm: { alarmId: '201', projectId: 'project-1', postId: 'post-1', remarkId: '-1', replyId: '-1', receiverId: 'me@example.test', registerId: 'author@example.test', registerName: '알림 보낸 사람', registeredDateTime: '20261019235000' },
              post: { postId: 'post-1', title: '쿠폰 만료 처리 오류 수정', connectUrl: null, registerId: 'author@example.test', registerName: '업무 작성자', registeredDateTime: '20261019230000', textComponents: [], attachments: [] },
              taskId: 'task-1',
              assignedAt: '20261019235000',
              assignedAtEstimated: true,
              answers: [],
              answered: true,
              missReasons: ['pre-feature-task', 'no-evidence'],
              projectTitle: '백오피스',
            },
          ],
          hasMore: false,
          loadingMore: false,
          moreFailure: null,
        },
      },
    };

    /** 업무 본문 자리를 찾은 게시물. */
    const places: string[] = [];
    const snapshot = manualCheckSnapshot(state, true, none, (postId) => {
      places.push(postId);
      return { kind: 'bundle', bundleId: 9, status: 'ready' };
    });

    expect(places).toEqual(['post-1']);
    expect(snapshot.sheet).toMatchObject({ tab: 'assignments', status: 'loaded', hasMore: false });
    expect(snapshot.sheet?.status === 'loaded' && snapshot.sheet.rows).toEqual([
      {
        kind: 'assignment',
        alarmId: '201',
        senderName: '업무 작성자',
        projectTitle: '백오피스',
        firstLine: '쿠폰 만료 처리 오류 수정',
        at: Date.UTC(2026, 9, 19, 14, 50),
        tags: [{ kind: 'answered' }, { kind: 'bundle', bundleId: 9, status: 'ready' }],
        missReasons: ['pre-feature-task', 'no-evidence'],
      },
    ]);
    expect(JSON.stringify(snapshot)).not.toContain('example.test');
    // 아직 불러오지 않은 담당 업무 탭은 불러오는 중으로 보인다.
    expect(manualCheckSnapshot({ sheet: { window: 'popover', tab: 'assignments', mentions: { status: 'loading' }, assignments: { status: 'idle' } } }, true, none, none).sheet).toMatchObject({
      tab: 'assignments',
      status: 'loading',
    });
  });
});

describe('묶음 스냅숏: 담당 해제', () => {
  /** 준비된 초안. */
  const draft = {
    requirement: { text: '배포 순서를 알고 싶다.', summary: '배포 순서' },
    paragraphs: [{ sentences: [{ text: '먼저 API를 배포합니다.', evidence: [] }] }],
    evidence: [],
    repositories: ['/fake/work/billing-api'],
    autoSelection: null,
    createdAt: 144_000,
  };
  /** 배정 자료. */
  const assignment = { taskId: 'task-1', authorId: 'author@example.test', authorName: '업무 작성자', assignedAt: '20261020090100' };

  it('담당자에서 제외된 담당 업무 초안은 해제를 표시하고 게시와 다시 만들기를 막으며, 편집은 그대로 둔다', () => {
    /** 스냅숏. */
    const snapshot = bundleSnapshot(bundle({ status: 'ready', remarkId: '-1', mentions: [], draft, assignment: { ...assignment, unassignedAt: 5_000 } }), () => PROJECT);
    expect(snapshot.assignment?.blockedByUnassignment).toBe(true);
    expect(snapshot.draft).toMatchObject({ canPost: false, canRegenerate: false, canEdit: true });
  });

  it('배정 근거 없이 알림 시각으로 대신한 배정 시각은 추정 표시와 함께 넘기고, 근거 시각은 표시 없이 넘긴다', () => {
    /** 추정 배정 시각의 스냅숏. */
    const estimated = bundleSnapshot(bundle({ status: 'ready', remarkId: '-1', mentions: [], draft, assignment: { ...assignment, assignedAtEstimated: true } }), () => PROJECT);
    expect(estimated.assignment).toMatchObject({ assignedAt: Date.UTC(2026, 9, 20, 0, 1), assignedAtEstimated: true });
    /** 근거 시각의 스냅숏. */
    const evidenced = bundleSnapshot(bundle({ status: 'ready', remarkId: '-1', mentions: [], draft, assignment }), () => PROJECT);
    expect(evidenced.assignment?.assignedAtEstimated).toBeUndefined();
  });

  it('직접 멘션이 남은 합친 묶음은 담당만 해제돼도 게시할 수 있다', () => {
    /** 스냅숏. */
    const snapshot = bundleSnapshot(
      bundle({ status: 'ready', remarkId: '-1', mentions: [mention('101', { remarkId: '-1' })], draft, assignment: { ...assignment, unassignedAt: 5_000 } }),
      () => PROJECT,
      undefined,
      MAPPED,
    );
    expect(snapshot.assignment?.blockedByUnassignment).toBe(false);
    expect(snapshot.draft).toMatchObject({ canPost: true, canRegenerate: true });
  });
});

describe('진단 스냅숏', () => {
  /** 가짜 진단. */
  function diagnosis(id: number, overrides: Partial<SentryDiagnosis> = {}): SentryDiagnosis {
    return {
      id,
      projectId: '11',
      issueId: String(100 + id),
      origin: 'new',
      regressionEventId: null,
      detectedAt: 1_000 + id,
      status: 'repo-check-needed',
      repoCheck: { kind: 'unmapped' },
      report: null,
      failure: null,
      runs: [],
      completedAt: null,
      lastExport: null,
      directives: [],
      rediagnosisFailure: null,
      issue: {
        shortId: `WEB-${id}`,
        title: `시험 오류 ${id}`,
        culprit: 'app/checkout',
        level: 'error',
        environment: 'production',
        firstSeen: 500,
        lastSeen: 900,
        count: 3,
        userCount: 1,
        permalink: 'https://fake.sentry.test/issues/1/',
        platform: 'javascript',
        organizationName: '가짜 조직',
        projectName: '가짜 프로젝트',
      },
      ...overrides,
    };
  }

  it('진단은 묶음과 따로 배열로 넘기고, 오류 제목·감지 시각·프로젝트·자리·상태를 담는다', () => {
    const [snapshot] = diagnosisSnapshots([diagnosis(1, { status: 'queued', repoCheck: null })]);

    expect(snapshot).toEqual({
      id: 1,
      projectId: '11',
      origin: 'new',
      title: '시험 오류 1',
      detectedAt: 1_001,
      status: 'queued',
      repoWait: null,
      progress: { status: 'waiting', ahead: null },
      report: null,
      failure: null,
      rediagnosing: false,
      directives: [],
      rediagnosisFailure: null,
      completedAt: null,
      exported: false,
      lastExportedPath: null,
      canOpenInSentry: false,
      attachments: [],
      issue: {
        shortId: 'WEB-1',
        culprit: 'app/checkout',
        level: 'error',
        environment: 'production',
        firstSeen: 500,
        lastSeen: 900,
        count: 3,
        userCount: 1,
        platform: 'javascript',
        organizationName: '가짜 조직',
        projectName: '가짜 프로젝트',
      },
    });
  });

  it('다시 진단하는 중이면 앞선 보고서를 보관한 채 대기·진행 중이고, 돌아온 진단은 사유와 쌓인 지시를 넘긴다', () => {
    /** 앞선 보고서. */
    const report: NonNullable<SentryDiagnosis['report']> = {
      summary: '요약',
      reproduction: { result: 'impossible', impossibleReason: 'not-allowed', method: '', steps: [] },
      cause: { text: '원인', confidence: 'low' },
      improvements: [],
      openQuestions: [],
      evidence: [],
      event: { eventId: 'e1', release: null, firstRelease: null, lastRelease: null, sourceMaps: 'unknown', missingData: [], stackHead: [] },
      run: { repository: '/fake/web', headCommit: null, uncommittedChanges: null, agent: 'claude-code', cliVersion: null, reproductionAllowed: false, durationMs: 1, createdAt: 7 },
      priorDiagnosis: { kind: 'in-review' },
    };
    const [again, running, returned, fresh] = diagnosisSnapshots(
      [
        diagnosis(1, { status: 'queued', repoCheck: null, report, directives: ['더 짧게'] }),
        diagnosis(2, { status: 'queued', repoCheck: null, report }),
        diagnosis(3, { status: 'ready', repoCheck: null, report, directives: ['더 짧게'], rediagnosisFailure: { reason: 'cancelled', detail: null, lastStep: null, runKind: null } }),
        diagnosis(4, { status: 'queued', repoCheck: null }),
      ],
      (id) => (id === 2 ? { status: 'running', step: '진단하는 중', filesRead: 1, startedAt: 5 } : null),
    );

    expect(again).toMatchObject({ status: 'queued', rediagnosing: true, directives: ['더 짧게'], rediagnosisFailure: null });
    expect(again!.report?.summary).toBe('요약');
    expect(again!.report?.priorDiagnosis).toEqual({ kind: 'in-review' });
    expect(running).toMatchObject({ status: 'running', rediagnosing: true });
    expect(returned).toMatchObject({ status: 'ready', rediagnosing: false, directives: ['더 짧게'], rediagnosisFailure: { reason: 'cancelled', detail: null, lastStep: null } });
    // 처음 진단하는 대기에는 보고서가 없어 다시 진단이 아니다.
    expect(fresh).toMatchObject({ status: 'queued', rediagnosing: false, report: null });
  });

  it('내보낸 기록은 지금 보고서를 내보냈는지(exported)와 마지막 파일 경로로 넘긴다', () => {
    /** 보고서 생성 시각이 7인 가짜 보고서. */
    const report: NonNullable<SentryDiagnosis['report']> = {
      summary: '요약',
      reproduction: { result: 'impossible', impossibleReason: 'not-allowed', method: '', steps: [] },
      cause: { text: '원인', confidence: 'low' },
      improvements: [],
      openQuestions: [],
      evidence: [],
      event: { eventId: 'e1', release: null, firstRelease: null, lastRelease: null, sourceMaps: 'unknown', missingData: [], stackHead: [] },
      run: { repository: '/fake/web', headCommit: null, uncommittedChanges: null, agent: 'claude-code', cliVersion: null, reproductionAllowed: false, durationMs: 1, createdAt: 7 },
      priorDiagnosis: null,
    };
    /** 검토 대기 진단. */
    const ready = (lastExport: SentryDiagnosis['lastExport']) => diagnosis(1, { status: 'ready', repoCheck: null, report, lastExport });
    const [fresh, same, older] = diagnosisSnapshots([
      ready(null),
      ready({ path: '/내보냄/a.md', at: 10, reportCreatedAt: 7 }),
      ready({ path: '/내보냄/b.md', at: 10, reportCreatedAt: 3 }),
    ]);

    expect([fresh?.exported, fresh?.lastExportedPath]).toEqual([false, null]);
    expect([same?.exported, same?.lastExportedPath]).toEqual([true, '/내보냄/a.md']);
    // 다시 진단으로 보고서가 바뀌면 옛 내보내기는 지금 보고서의 것이 아니지만 마지막 파일 경로는 남는다.
    expect([older?.exported, older?.lastExportedPath]).toEqual([false, '/내보냄/b.md']);
  });

  it('[Sentry에서 열기]는 공식 sentry.io 주소가 있을 때만 열 수 있다고 넘기고 주소 자체는 넘기지 않는다', () => {
    /** 주소만 다른 진단. */
    const withLink = (permalink: string | null) => diagnosis(1, { issue: { ...diagnosis(1).issue, permalink } });
    const snapshots = diagnosisSnapshots([
      withLink('https://org-a.sentry.io/issues/1/'),
      withLink('https://sentry.io/organizations/org-a/issues/1/'),
      withLink('http://org-a.sentry.io/issues/1/'),
      withLink('https://evil.example/issues/1/'),
      withLink('https://notsentry.io/issues/1/'),
      withLink('javascript:alert(1)'),
      withLink(null),
    ]);

    expect(snapshots.map((item) => item.canOpenInSentry)).toEqual([true, true, false, false, false, false, false]);
    expect(JSON.stringify(snapshots)).not.toContain('sentry.io/issues');
  });

  it('대기 진단은 생성 대기열이 진행하고 있으면 진행 중으로 넘기고, 기다리면 앞에 있는 수를 넘긴다', () => {
    /** 진단 ID마다 대기열의 진행. */
    const progress = new Map([
      [1, { status: 'running' as const, step: '오류 진단하는 중', filesRead: 2, startedAt: 5_000 }],
      [2, { status: 'waiting' as const, ahead: 1 }],
    ]);
    const snapshots = diagnosisSnapshots(
      [diagnosis(1, { status: 'queued', repoCheck: null }), diagnosis(2, { status: 'queued', repoCheck: null }), diagnosis(3)],
      (id) => progress.get(id) ?? null,
    );

    expect(snapshots.map((item) => [item.status, item.progress])).toEqual([
      ['running', { status: 'running', step: '오류 진단하는 중', filesRead: 2, startedAt: 5_000 }],
      ['queued', { status: 'waiting', ahead: 1 }],
      ['repo-check-needed', null],
    ]);
  });

  it('진단 실패는 사유와 마지막 단계를, 완료는 완료 시각을 넘긴다', () => {
    const [failed, completed] = diagnosisSnapshots([
      diagnosis(1, { status: 'failed', repoCheck: null, failure: { reason: 'cancelled', detail: null, lastStep: '오류 진단하는 중', runKind: 'diagnosis' } }),
      diagnosis(2, { status: 'completed', repoCheck: null, completedAt: 7_000 }),
    ]);

    expect(failed).toMatchObject({ status: 'failed', failure: { reason: 'cancelled', detail: null, lastStep: '오류 진단하는 중' }, progress: null });
    expect(completed).toMatchObject({ status: 'completed', completedAt: 7_000, report: null });
  });

  it('저장소 대기는 같은 프로젝트·사유로 기다리는 진단 수를 넘긴다. 사유나 프로젝트가 다르면 따로 센다', () => {
    const snapshots = diagnosisSnapshots([
      diagnosis(1),
      diagnosis(2),
      diagnosis(3, { projectId: '12' }),
      diagnosis(4, { repoCheck: { kind: 'missing-folder', path: '/fake/gone' } }),
      diagnosis(5, { status: 'queued', repoCheck: null }),
    ]);

    expect(snapshots.map((item) => item.repoWait)).toEqual([
      { kind: 'unmapped', waitingCount: 2 },
      { kind: 'unmapped', waitingCount: 2 },
      { kind: 'unmapped', waitingCount: 1 },
      { kind: 'missing-folder', path: '/fake/gone', waitingCount: 1 },
      null,
    ]);
  });
});
