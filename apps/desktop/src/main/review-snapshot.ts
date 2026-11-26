import { basename } from 'node:path';
import { bundleChanges, type BundleChanges } from '../core/bundles/bundle-changes';
import { activeMentions, repoWaitKey, canEditDraft, canRegenerate, isRepoUndetermined, isRestorable, isUnassignedBlocked, listGroupOf, type MentionBundle, type RepoCheck } from '../core/bundles/mention-bundle';
import type { Draft } from '../core/drafts/draft';
import { bundleRecipients, draftEditorText, isPostable, postBody } from '../core/drafts/post-body';
import { bundleSourceWords, developerTerms } from '../core/drafts/style-check';
import { flowTimeToEpochMs } from '../core/flow/flow-time';
import { namedMentionText, splitMentionMarkup } from '../core/flow/mention-markup';
import { isPostBody, mentionPlaceOf } from '../core/flow/mention-place';
import { mentionWritingOf, type BundleContext, type ContextWriting } from '../core/flow/bundle-context';
import { commentKey, mentionWritingKey, POST_WRITING_KEY, replyKey } from '../core/flow/context-changes';
import type { MappingMatch } from '../core/repos/repo-mappings';
import type { RepoPickerState } from '../core/repos/repo-picker';
import type { ManualPlace } from '../core/bundles/mention-bundles';
import type { ManualCheckState } from '../core/manual-check/manual-check-session';
import type { ManualAssignmentCandidate, ManualMentionCandidate } from '../core/manual-check/manual-mention-check';
import { hasExportedCurrentReport, isRediagnosing, isRepoWaiting, openableSentryUrl, type DiagnosisFailure, type DiagnosisReport, type SentryDiagnosis } from '../core/sentry/sentry-diagnosis';
import type {
  BundleMentionSnapshot,
  DiagnosisFailureSnapshot,
  DiagnosisProgressSnapshot,
  DiagnosisReportSnapshot,
  DiagnosisSnapshot,
  BundleSnapshot,
  DraftSnapshot,
  GenerationSnapshot,
  MentionPlaceSnapshot,
  PostingSnapshot,
  RepoCheckSnapshot,
  RepoPickerSnapshot,
  ReviewSnapshot,
  RunLineSnapshot,
  ThreadEntrySnapshot,
  ManualCheckRowSnapshot,
  ManualCheckRowTagSnapshot,
  ManualCheckSnapshot,
  WritingChangeSnapshot,
} from '../shared/ipc';

/** 참여 목록에서 찾은 Flow 프로젝트. */
export interface FlowProjectInfo {
  /** Flow 프로젝트 이름. */
  title: string;
  /** Flow 프로젝트 주소. 없으면 `null`. */
  projectUrl: string | null;
}

/** Flow 프로젝트 ID로 참여 목록의 프로젝트를 찾는다. 목록을 아직 받지 않았거나 없으면 `null`. */
export type ProjectLookup = (projectId: string) => FlowProjectInfo | null;

/** 묶음 ID로 초안 대기열의 진행을 찾는다. 대기열에 없으면 `null`. */
export type GenerationLookup = (bundleId: number) => GenerationSnapshot | null;

/** Flow 프로젝트의 저장소 매핑과 저장소 구성을 견준다. */
export type MappingLookup = (projectId: string, repos: readonly string[]) => MappingMatch;

/** 진단 ID로 생성 대기열의 진행을 찾는다. 대기열에 없으면 `null`. */
export type DiagnosisProgressLookup = (diagnosisId: number) => DiagnosisProgressSnapshot | null;

/** 묶음 ID로 게시 카운트다운이 끝날 시각을 찾는다. 카운트다운 중이 아니면 `null`. */
export type CountdownLookup = (bundleId: number) => number | null;

/** 작은 창과 펼친 창이 그릴 묶음과 진단 상태. `bundles`는 대기열 순서 그대로 넘긴다. 진단은 묶음과 따로 감지한 순서로 넘긴다. */
export function reviewSnapshot(
  bundles: readonly MentionBundle[],
  diagnoses: readonly SentryDiagnosis[],
  sections: ReviewSnapshot['sections'],
  projectOf: ProjectLookup,
  generationOf: GenerationLookup,
  mappingOf: MappingLookup,
  repoPicker: RepoPickerState | null,
  countdownOf: CountdownLookup,
  diagnosisProgressOf: DiagnosisProgressLookup = () => null,
  reproductionAllowedOf: (projectId: string) => boolean = () => false,
): ReviewSnapshot {
  /** 프로젝트와 사유별로 기다리는 저장소 대기 묶음 수. 바닥 줄 글의 "기다리는 n건"이다. */
  const waitCounts = new Map<string, number>();
  for (const bundle of bundles) {
    if (bundle.draft !== null || bundle.status !== 'repo-check-needed') continue;
    /** 센 키. */
    const key = repoWaitKey(bundle);
    waitCounts.set(key, (waitCounts.get(key) ?? 0) + 1);
  }
  return {
    bundles: bundles.map((bundle) => bundleSnapshot(bundle, projectOf, generationOf, mappingOf, countdownOf, (item) => waitCounts.get(repoWaitKey(item)) ?? 1)),
    diagnoses: diagnosisSnapshots(diagnoses, diagnosisProgressOf, reproductionAllowedOf),
    sections: { compact: { ...sections.compact }, expanded: { ...sections.expanded } },
    repoPicker: repoPicker && repoPickerSnapshot(repoPicker),
  };
}

/**
 * 진단을 렌더러에 넘길 모양으로 바꾼다. 저장소 대기는 같은 프로젝트·사유로 기다리는 진단 수를 함께 넘겨 바닥 줄의 "기다리는 오류 n건"이 된다.
 * 대기 진단은 생성 대기열이 진행하고 있으면 진행 중(`running`)으로 넘긴다. 오류 제목은 검토 화면에만 보이고 OS 알림에는 넣지 않는다.
 */
export function diagnosisSnapshots(
  diagnoses: readonly SentryDiagnosis[],
  progressOf: DiagnosisProgressLookup = () => null,
  reproductionAllowedOf: (projectId: string) => boolean = () => false,
): DiagnosisSnapshot[] {
  /** 프로젝트와 사유별로 기다리는 진단 수. */
  const waitCounts = new Map<string, number>();
  /** 프로젝트와 사유를 묶는 키. */
  const waitKey = (diagnosis: SentryDiagnosis) => `${diagnosis.projectId}\u0000${diagnosis.repoCheck?.kind ?? ''}`;
  for (const diagnosis of diagnoses) if (isRepoWaiting(diagnosis)) waitCounts.set(waitKey(diagnosis), (waitCounts.get(waitKey(diagnosis)) ?? 0) + 1);
  return diagnoses.map((diagnosis): DiagnosisSnapshot => {
    /** 같은 프로젝트·사유로 기다리는 진단 수. */
    const waitingCount = waitCounts.get(waitKey(diagnosis)) ?? 1;
    /** 오류 이슈 정보와 저장소 대기 사유. */
    const { issue, repoCheck } = diagnosis;
    /** 대기 진단의 진행. 대기가 아니면 `null`. */
    const progress = diagnosis.status === 'queued' ? (progressOf(diagnosis.id) ?? { status: 'waiting', ahead: null }) : null;
    return {
      id: diagnosis.id,
      projectId: diagnosis.projectId,
      origin: diagnosis.origin,
      title: issue.title,
      detectedAt: diagnosis.detectedAt,
      status: progress?.status === 'running' ? 'running' : diagnosis.status,
      progress,
      report: diagnosis.report && reportSnapshot(diagnosis.report),
      failure: diagnosis.failure && failureSnapshot(diagnosis.failure),
      rediagnosing: isRediagnosing(diagnosis),
      directives: [...diagnosis.directives],
      rediagnosisFailure: diagnosis.rediagnosisFailure && failureSnapshot(diagnosis.rediagnosisFailure),
      completedAt: diagnosis.completedAt,
      exported: hasExportedCurrentReport(diagnosis),
      lastExportedPath: diagnosis.lastExport?.path ?? null,
      canOpenInSentry: openableSentryUrl(issue.permalink) !== null,
      attachments: diagnosis.report?.attachments.map((item) => ({ ...item })) ?? [],
      reproductionAllowed: reproductionAllowedOf(diagnosis.projectId),
      repoWait:
        !isRepoWaiting(diagnosis) || repoCheck === null
          ? null
          : repoCheck.kind === 'unmapped'
            ? { kind: 'unmapped', waitingCount }
            : { kind: 'missing-folder', path: repoCheck.path, waitingCount },
      issue: {
        shortId: issue.shortId,
        culprit: issue.culprit,
        level: issue.level,
        environment: issue.environment,
        firstSeen: issue.firstSeen,
        lastSeen: issue.lastSeen,
        count: issue.count,
        userCount: issue.userCount,
        platform: issue.platform,
        organizationName: issue.organizationName,
        projectName: issue.projectName,
      },
    };
  });
}

/** 진단 실패의 까닭을 렌더러에 넘길 모양으로 바꾼다. */
function failureSnapshot(failure: DiagnosisFailure): DiagnosisFailureSnapshot {
  return { reason: failure.reason, detail: failure.detail, lastStep: failure.lastStep };
}

/** 진단 보고서를 렌더러에 넘길 모양으로 바꾼다. */
function reportSnapshot(report: DiagnosisReport): DiagnosisReportSnapshot {
  return {
    summary: report.summary,
    reproduction: { ...report.reproduction, steps: [...report.reproduction.steps] },
    cause: { ...report.cause },
    improvements: [...report.improvements],
    openQuestions: [...report.openQuestions],
    evidence: report.evidence.map((item) => ({ ...item })),
    event: {
      release: report.event.release,
      firstRelease: report.event.firstRelease,
      lastRelease: report.event.lastRelease,
      sourceMaps: report.event.sourceMaps,
      missingData: [...report.event.missingData],
      stackHead: [...report.event.stackHead],
    },
    run: { ...report.run },
    priorDiagnosis: report.priorDiagnosis && { ...report.priorDiagnosis },
    omittedAttachments: report.omittedAttachments,
  };
}

/** 멘션 위치에 있는 기존 기록을 찾는 함수. */
export type ManualPlaceLookup = (mention: ManualMentionCandidate['mention']) => ManualPlace;

/** 업무 본문 자리(게시물 ID)에 있는 기존 기록을 찾는 함수. */
export type ManualAssignmentPlaceLookup = (postId: string) => ManualPlace;

/**
 * 최근 멘션 확인의 상태를 렌더러에 넘길 모양으로 바꾼다. 지금 보는 탭의 목록 상태만 넘기고, 담당 업무 탭을 아직 불러오지 않았으면 불러오는 중으로 본다.
 * 줄 태그는 지금 묶음 상태로 정하므로 묶음이 바뀌면 태그도 따라 바뀐다.
 * 멘션은 송신자, Flow 프로젝트, 첫 줄, 시각만 넘기고 Flow 사용자 ID는 넘기지 않는다.
 */
export function manualCheckSnapshot(state: ManualCheckState, canOpen: boolean, placeOf: ManualPlaceLookup, assignmentPlaceOf: ManualAssignmentPlaceLookup): ManualCheckSnapshot {
  /** 열린 시트. */
  const sheet = state.sheet;
  if (sheet === null) return { canOpen, sheet: null };
  /** 시트를 연 창과 지금 탭. */
  const head = { window: sheet.window, tab: sheet.tab };
  /** 지금 탭의 목록 상태. */
  const list = sheet.tab === 'mentions' ? sheet.mentions : sheet.assignments;
  if (list.status === 'idle' || list.status === 'loading') return { canOpen, sheet: { ...head, status: 'loading' } };
  if (list.status === 'failed') return { canOpen, sheet: { ...head, status: 'failed', reason: list.reason } };
  return {
    canOpen,
    sheet: {
      ...head,
      status: 'loaded',
      rows:
        sheet.tab === 'mentions'
          ? (sheet.mentions.status === 'loaded' ? sheet.mentions.candidates : []).map((candidate) => manualCheckRowSnapshot(candidate, placeOf))
          : (sheet.assignments.status === 'loaded' ? sheet.assignments.candidates : []).map((candidate) => manualAssignmentRowSnapshot(candidate, assignmentPlaceOf)),
      hasMore: list.hasMore,
      loadingMore: list.loadingMore,
      moreFailure: list.moreFailure,
    },
  };
}

/** 줄의 기존 기록을 상태 태그로 바꾼다. 묶음은 "이미 묶음 있음"과 그 상태, 최소 기록만 있으면 "처리됨"이다. */
function placeTags(place: ManualPlace): ManualCheckRowTagSnapshot[] {
  if (place.kind === 'bundle') return [{ kind: 'bundle', bundleId: place.bundleId, status: place.status }];
  return place.kind === 'record' ? [{ kind: 'archived' }] : [];
}

/** 최근 멘션 확인 시트의 멘션 줄 하나. 태그는 "답함", 기존 묶음(상태), 처리됨 순서다. */
function manualCheckRowSnapshot({ mention, projectTitle, answered }: ManualMentionCandidate, placeOf: ManualPlaceLookup): ManualCheckRowSnapshot {
  return {
    kind: 'mention',
    alarmId: mention.alarmId,
    senderName: mention.senderName,
    projectTitle,
    firstLine: firstLineOf(mention.text),
    at: flowTimeToEpochMs(mention.registeredDateTime) ?? mention.detectedAt,
    tags: [...(answered ? [{ kind: 'answered' as const }] : []), ...placeTags(placeOf(mention))],
    missReasons: [],
  };
}

/** 최근 멘션 확인 시트의 담당 업무 줄 하나. 작성자, Flow 프로젝트, 업무 제목, 알림 시각과 "답함", 기존 묶음(상태), 처리됨 태그, 감지에서 빠진 이유를 넘긴다. */
function manualAssignmentRowSnapshot(
  { alarm, post, answered, missReasons, projectTitle }: ManualAssignmentCandidate,
  assignmentPlaceOf: ManualAssignmentPlaceLookup,
): ManualCheckRowSnapshot {
  return {
    kind: 'assignment',
    alarmId: alarm.alarmId,
    senderName: post.registerName,
    projectTitle,
    firstLine: post.title,
    at: flowTimeToEpochMs(alarm.registeredDateTime) ?? 0,
    tags: [...(answered ? [{ kind: 'answered' as const }] : []), ...placeTags(assignmentPlaceOf(post.postId))],
    missReasons: [...missReasons],
  };
}

/** 배정 시각을 상세에 보일 값으로 바꾼다. 시각을 읽을 수 없으면 아무것도 넣지 않고, 추정이면 그 표시를 함께 넣는다. */
function assignedAtSnapshot(assignment: { assignedAt?: string; assignedAtEstimated?: boolean }): { assignedAt?: number; assignedAtEstimated?: true } {
  /** 배정 시각. */
  const assignedAt = assignment.assignedAt ? flowTimeToEpochMs(assignment.assignedAt) : null;
  if (assignedAt === null) return {};
  return { assignedAt, ...(assignment.assignedAtEstimated ? { assignedAtEstimated: true as const } : {}) };
}

/** 멘션 글의 비어 있지 않은 첫 줄. 멘션 표기는 `@이름`으로 바꾼다. */
function firstLineOf(text: string): string {
  return (
    namedMentionText(text)
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line !== '') ?? ''
  );
}

/** 저장소 선택 창의 상태를 렌더러에 넘길 모양으로 바꾼다. */
function repoPickerSnapshot(picker: RepoPickerState): RepoPickerSnapshot {
  return { ...picker, choices: picker.choices.map((choice) => ({ ...choice })) };
}

/**
 * 묶음 하나를 렌더러에 넘길 모양으로 바꾼다. Flow 사용자 ID와 주소, 실행 기록의 비용은 넘기지 않는다.
 * 원문 영역에는 묶음에 남은 멘션을 보이고, 모든 멘션이 빠진 이미 답함 묶음이면 빠진 멘션을 보인다.
 * 생성 중 묶음의 진행은 초안 대기열에서 찾고, 대기열이 아직 모르면 기다리는 것으로 본다. 게시 중 묶음의 카운트다운은 게시에서 찾는다.
 */
export function bundleSnapshot(
  bundle: MentionBundle,
  projectOf: ProjectLookup,
  generationOf: GenerationLookup = () => null,
  mappingOf: MappingLookup = () => 'unmapped',
  countdownOf: CountdownLookup = () => null,
  repoWaitCountOf: (bundle: MentionBundle) => number = () => 1,
): BundleSnapshot {
  /** 묶음에 남은 멘션. */
  const active = activeMentions(bundle);
  /** 준비된 뒤의 변화 감시가 찾은 변화. */
  const changes = bundleChanges(bundle);
  /** 수정된 글의 키. */
  const edited = new Set(changes.editedWritings);
  /** 원문 영역에 보일 멘션. 감시가 조회했으면 멘션 글의 지금 내용을 보인다. */
  const shown: BundleMentionSnapshot[] = (active.length > 0 ? active : bundle.mentions).map((mention) => ({
    senderName: mention.senderName,
    place: mentionPlaceOf(mention) ?? 'post',
    at: flowTimeToEpochMs(mention.registeredDateTime) ?? mention.detectedAt,
    text: splitMentionMarkup((bundle.watchedContext && mentionWritingOf(bundle.watchedContext, mention)?.contents) ?? mention.text),
    edited: edited.has(mentionWritingKey(mention) ?? ''),
  }));
  return {
    id: bundle.id,
    status: bundle.status,
    group: listGroupOf(bundle.status),
    place: isPostBody(bundle) ? 'post' : 'thread',
    projectTitle: projectOf(bundle.projectId)?.title || null,
    postTitle: bundle.postTitle,
    mentions: shown,
    ...(bundle.assignment
      ? { assignment: { text: splitMentionMarkup((bundle.watchedContext ?? bundle.context)?.post.contents ?? ''), blockedByUnassignment: isUnassignedBlocked(bundle), ...assignedAtSnapshot(bundle.assignment) } }
      : {}),
    senderNames: bundle.assignment ? [bundle.context?.post.authorName || bundle.assignment.authorName] : [...new Set(shown.map((mention) => mention.senderName).filter(Boolean))],
    newMentionCount: bundle.newMentionCount,
    directives: [...bundle.directives],
    lastMentionAt: shown.length > 0 ? Math.max(...shown.map((mention) => mention.at)) : bundle.createdAt,
    processedAt: bundle.processedAt,
    canRestore: isRestorable(bundle.status),
    canOpenInFlow: flowUrlOf(bundle, projectOf) !== null,
    thread: threadEntries(bundle.watchedContext ?? bundle.context, changes),
    draft: bundle.draft && draftSnapshot(bundle, bundle.draft, mappingOf(bundle.projectId, bundle.draft.repositories)),
    run: runLine(bundle),
    generation: bundle.status === 'generating' ? (generationOf(bundle.id) ?? { status: 'waiting' }) : null,
    failure: bundle.failure && { ...bundle.failure },
    repoCheck: bundle.repoCheck && { ...repoCheckSnapshot(bundle.repoCheck, bundle.userRepos !== null), waitingCount: repoWaitCountOf(bundle) },
    posting: postingSnapshot(bundle, countdownOf),
    postFailure: bundle.status === 'post-failed' ? (bundle.posting?.failure ?? 'no-response') : null,
    // 그 뒤 게시 중이 되었거나 처리한 묶음에는 보이지 않는다.
    quitDuringCountdown: bundle.status === 'ready' && bundle.quitDuringCountdown,
    changes: { newWritingCount: changes.newWritings.length, edited: changes.editedWritings.length > 0, goneMentionCount: changes.goneMentions },
    manual: bundle.manual,
  };
}

/**
 * 게시 중 묶음의 단계. 카운트다운 중이면 게시 요청을 보낼 시각을, 그 밖에는 결과를 기다린다고 넘긴다.
 * 게시 요청을 보낸 뒤(게시 기록이 있음)에는 카운트다운이 없다. 게시 중이 아니면 `null`.
 */
function postingSnapshot(bundle: MentionBundle, countdownOf: CountdownLookup): PostingSnapshot | null {
  if (bundle.status !== 'posting') return null;
  /** 카운트다운이 끝날 시각. */
  const endsAt = bundle.posting === null ? countdownOf(bundle.id) : null;
  return endsAt === null ? { phase: 'sending' } : { phase: 'countdown', endsAt };
}

/**
 * 초안을 렌더러에 넘길 모양으로 바꾼다. 저장소는 폴더 이름을 붙여 넘긴다.
 * `mapping`은 그 구성을 저장소 매핑과 견준 것이다. 편집기 텍스트와 받는 사람도 함께 넘기되, 받는 사람의 사용자 ID는 넘기지 않는다.
 */
function draftSnapshot(bundle: MentionBundle, draft: Draft, mapping: MappingMatch): DraftSnapshot {
  /** 받는 사람. */
  const recipients = bundleRecipients(bundle);
  /** 문체 검사에서 뺄 단어. */
  const source = bundleSourceWords(bundle);
  /** 저장소가 정해지지 않은 초안인지 여부. 고른 저장소도 저장소 매핑도 없다. 다시 만들 수 있는 준비됨 묶음에서만 알린다. */
  const repoUndetermined = bundle.status === 'ready' && isRepoUndetermined(bundle, mapping !== 'unmapped');
  return {
    requirement: { ...draft.requirement },
    paragraphs: draft.paragraphs.map((paragraph) => ({
      sentences: paragraph.sentences.map((sentence) => ({ ...sentence, evidence: [...sentence.evidence], developerTerms: developerTerms(sentence.text, source) })),
    })),
    evidence: draft.evidence.map(({ id, explanation, repository, path, startLine, endLine, located }) => ({
      id,
      explanation,
      repositoryName: basename(repository),
      path,
      startLine,
      endLine,
      located,
      developerTerms: developerTerms(explanation, source),
    })),
    repositories: draft.repositories.map((path) => ({ name: basename(path), path })),
    mapping,
    editorText: bundle.editedText ?? draftEditorText(draft),
    edited: bundle.editedText !== null,
    canEdit: canEditDraft(bundle.status),
    canRegenerate: canRegenerate(bundle.status) && !isUnassignedBlocked(bundle) && !repoUndetermined,
    repoUndetermined,
    recipients: recipients.map(({ name }) => ({ name })),
    // 빈 편집기 텍스트의 게시 본문이 곧 받는 사람 표기와 이어 붙이는 공백이다.
    postBodyPrefixLength: postBody(recipients, '').length,
    canPost: isPostable(bundle),
  };
}

/**
 * 저장소 대기의 사유를 렌더러에 넘길 모양으로 바꾼다.
 * `chosenByUser`는 묶음에 고른 구성이 있는지다. 있으면 실행 직전에 매핑 대신 그 구성을 확인했으므로 사라진 폴더도 그 구성의 것이다.
 */
function repoCheckSnapshot(repoCheck: RepoCheck, chosenByUser: boolean): RepoCheckSnapshot {
  switch (repoCheck.kind) {
    case 'unmapped':
      return { kind: repoCheck.kind };
    case 'missing-folders':
      return { kind: repoCheck.kind, paths: [...repoCheck.paths], chosenByUser };
  }
}

/**
 * 상세 머리의 실행 줄. 초안이 있으면 그 초안을 만든 실행(마지막 성공), 실패 묶음이면 마지막 실행이다.
 * 생성 중이거나 그런 실행이 없으면 `null`. 과거 기록의 저장소 선택 실행은 종류를 `selection`으로 넘긴다.
 */
function runLine(bundle: MentionBundle): RunLineSnapshot | null {
  if (bundle.status === 'generating') return null;
  /** 실행 줄에 보일 실행. */
  const run = bundle.draft ? bundle.runs.findLast((record) => record.result === 'succeeded') : bundle.status === 'failed' ? bundle.runs.at(-1) : undefined;
  if (!run) return null;
  return {
    kind: run.kind === 'selection' ? 'selection' : 'draft',
    agent: run.agent,
    durationMs: Math.max(0, run.finishedAt - run.startedAt),
    contextOmitted: run.omittedContextItems > 0,
  };
}

/**
 * "스레드 보기"로 펼칠 글. 맥락의 게시물 본문 뒤에, 댓글 스레드 묶음이면 대상 댓글 스레드를, 본문 묶음이면 다른 댓글을 잇는다.
 * 댓글 스레드 묶음에서 다른 댓글 스레드는 넣지 않는다. 멘션 표기는 이름만 넘기고 사용자 ID는 넘기지 않는다.
 * 초안을 만든 뒤 새로 달렸거나 수정된 글에는 그 변화를 붙인다. 맥락이 없으면 비어 있다.
 */
function threadEntries(context: BundleContext | null, changes: BundleChanges): ThreadEntrySnapshot[] {
  if (!context) return [];
  /** 게시물, 대상 댓글 스레드, 다른 댓글. */
  const { post, targetThread, otherComments } = context;
  /** 이어 붙일 댓글. */
  const comments = targetThread ? [targetThread] : otherComments;
  /** 글 키로 그 글의 변화를 찾는다. */
  const changeOf = (key: string): WritingChangeSnapshot | null =>
    changes.newWritings.includes(key) ? 'new' : changes.editedWritings.includes(key) ? 'edited' : null;
  return [
    entryOf(post, 'post', changeOf(POST_WRITING_KEY)),
    ...comments.flatMap((comment) => [
      entryOf(comment, 'comment', changeOf(commentKey(comment.id))),
      ...comment.replies.map((reply) => entryOf(reply, 'reply', changeOf(replyKey(reply.id)))),
    ]),
  ];
}

/** 맥락의 글 하나를 "스레드 보기"의 글로 바꾼다. */
function entryOf(writing: ContextWriting, place: MentionPlaceSnapshot, change: WritingChangeSnapshot | null): ThreadEntrySnapshot {
  return {
    authorName: writing.authorName,
    place,
    at: flowTimeToEpochMs(writing.registeredDateTime),
    text: splitMentionMarkup(writing.contents),
    attachments: [...writing.attachments],
    mention: writing.mention,
    change,
  };
}

/**
 * "Flow에서 열기"로 열 주소. 게시물의 `connectUrl`을 먼저 쓰고, 없으면 Flow 프로젝트의 `projectUrl`을 쓴다.
 * Flow가 준 주소라도 OS가 다른 앱으로 열지 않게 https 주소만 연다. 열 주소가 없으면 `null`.
 */
export function flowUrlOf(bundle: MentionBundle, projectOf: ProjectLookup): string | null {
  return [bundle.connectUrl, projectOf(bundle.projectId)?.projectUrl].find(isHttpsUrl) ?? null;
}

/** https 주소인지 본다. */
function isHttpsUrl(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}
