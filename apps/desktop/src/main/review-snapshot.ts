import { basename } from 'node:path';
import { activeMentions, isRestorable, listGroupOf, type MentionBundle, type RepoCheck } from '../core/bundles/mention-bundle';
import type { Draft } from '../core/drafts/draft';
import { flowTimeToEpochMs } from '../core/flow/flow-time';
import { splitMentionMarkup } from '../core/flow/mention-markup';
import { isPostBody, mentionPlaceOf } from '../core/flow/mention-place';
import type { BundleContext, ContextWriting } from '../core/flow/bundle-context';
import type { RepoCandidate } from '../core/repos/repo-candidates';
import type { MappingMatch } from '../core/repos/repo-mappings';
import type { RepoPickerState } from '../core/repos/repo-picker';
import type {
  BundleMentionSnapshot,
  BundleSnapshot,
  DraftSnapshot,
  GenerationSnapshot,
  MentionPlaceSnapshot,
  RepoCheckSnapshot,
  RepoPickerSnapshot,
  RepositorySnapshot,
  ReviewSnapshot,
  RunLineSnapshot,
  ThreadEntrySnapshot,
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

/** 작은 창과 펼친 창이 그릴 묶음 상태. `bundles`는 대기열 순서 그대로 넘긴다. */
export function reviewSnapshot(
  bundles: readonly MentionBundle[],
  sections: ReviewSnapshot['sections'],
  projectOf: ProjectLookup,
  generationOf: GenerationLookup,
  mappingOf: MappingLookup,
  repoPicker: RepoPickerState | null,
): ReviewSnapshot {
  return {
    bundles: bundles.map((bundle) => bundleSnapshot(bundle, projectOf, generationOf, mappingOf)),
    sections: { compact: { ...sections.compact }, expanded: { ...sections.expanded } },
    repoPicker: repoPicker && repoPickerSnapshot(repoPicker),
  };
}

/** 저장소 선택 창의 상태를 렌더러에 넘길 모양으로 바꾼다. */
function repoPickerSnapshot(picker: RepoPickerState): RepoPickerSnapshot {
  if (picker.status === 'loading') return { ...picker };
  return { ...picker, choices: picker.choices.map((choice) => ({ ...choice })) };
}

/**
 * 묶음 하나를 렌더러에 넘길 모양으로 바꾼다. Flow 사용자 ID와 주소, 실행 기록의 비용은 넘기지 않는다.
 * 원문 영역에는 묶음에 남은 멘션을 보이고, 모든 멘션이 빠진 이미 답함 묶음이면 빠진 멘션을 보인다.
 * 생성 중 묶음의 진행은 초안 대기열에서 찾고, 대기열이 아직 모르면 기다리는 것으로 본다.
 */
export function bundleSnapshot(
  bundle: MentionBundle,
  projectOf: ProjectLookup,
  generationOf: GenerationLookup = () => null,
  mappingOf: MappingLookup = () => 'unmapped',
): BundleSnapshot {
  /** 묶음에 남은 멘션. */
  const active = activeMentions(bundle);
  /** 원문 영역에 보일 멘션. */
  const shown: BundleMentionSnapshot[] = (active.length > 0 ? active : bundle.mentions).map((mention) => ({
    senderName: mention.senderName,
    place: mentionPlaceOf(mention) ?? 'post',
    at: flowTimeToEpochMs(mention.registeredDateTime) ?? mention.detectedAt,
    text: splitMentionMarkup(mention.text),
  }));
  return {
    id: bundle.id,
    status: bundle.status,
    group: listGroupOf(bundle.status),
    place: isPostBody(bundle) ? 'post' : 'thread',
    projectTitle: projectOf(bundle.projectId)?.title || null,
    postTitle: bundle.postTitle,
    mentions: shown,
    senderNames: [...new Set(shown.map((mention) => mention.senderName).filter(Boolean))],
    newMentionCount: bundle.newMentionCount,
    lastMentionAt: shown.length > 0 ? Math.max(...shown.map((mention) => mention.at)) : bundle.createdAt,
    processedAt: bundle.processedAt,
    canRestore: isRestorable(bundle.status),
    canOpenInFlow: flowUrlOf(bundle, projectOf) !== null,
    thread: bundle.context ? threadEntries(bundle.context) : [],
    draft: bundle.draft && draftSnapshot(bundle.draft, mappingOf(bundle.projectId, bundle.draft.repositories)),
    run: runLine(bundle),
    generation: bundle.status === 'generating' ? (generationOf(bundle.id) ?? { status: 'waiting' }) : null,
    failure: bundle.failure && { ...bundle.failure },
    repoCheck: bundle.repoCheck && repoCheckSnapshot(bundle.repoCheck),
  };
}

/**
 * 초안을 렌더러에 넘길 모양으로 바꾼다. 저장소는 폴더 이름을 붙여 넘기고, 자동 선택으로 정했으면 그 내력도 넘긴다.
 * `mapping`은 그 구성을 저장소 매핑과 견준 것이다.
 */
function draftSnapshot(draft: Draft, mapping: MappingMatch): DraftSnapshot {
  return {
    requirement: { ...draft.requirement },
    paragraphs: draft.paragraphs.map((paragraph) => ({ sentences: paragraph.sentences.map((sentence) => ({ ...sentence, evidence: [...sentence.evidence] })) })),
    evidence: draft.evidence.map(({ id, explanation, repository, path, startLine, endLine, located }) => ({
      id,
      explanation,
      repositoryName: basename(repository),
      path,
      startLine,
      endLine,
      located,
    })),
    repositories: draft.repositories.map((path) => ({ name: basename(path), path })),
    autoSelection: draft.autoSelection && { ...draft.autoSelection },
    mapping,
  };
}

/**
 * 저장소 확인 필요의 사유를 렌더러에 넘길 모양으로 바꾼다.
 * 선택 실행의 후보는 에이전트가 짚은 것(짚은 순서)과 나머지(작업 폴더에서 찾은 순서)로 나눈다.
 */
function repoCheckSnapshot(repoCheck: RepoCheck): RepoCheckSnapshot {
  switch (repoCheck.kind) {
    case 'missing-folders':
      return { kind: repoCheck.kind, paths: [...repoCheck.paths] };
    case 'no-candidates':
      return { kind: repoCheck.kind };
    case 'unsure':
    case 'unrelated': {
      /** 후보를 렌더러의 저장소 모양으로 바꾼다. */
      const repositoryOf = ({ name, path }: RepoCandidate): RepositorySnapshot => ({ name, path });
      return {
        kind: repoCheck.kind,
        reason: repoCheck.reason,
        picked: repoCheck.picked.flatMap((path) => repoCheck.candidates.filter((candidate) => candidate.path === path)).map(repositoryOf),
        others: repoCheck.candidates.filter((candidate) => !repoCheck.picked.includes(candidate.path)).map(repositoryOf),
      };
    }
  }
}

/**
 * 상세 머리의 실행 줄. 초안이 있으면 그 초안을 만든 실행(마지막 성공), 실패 묶음이면 마지막 실행,
 * 선택 실행이 고르지 않아 저장소 확인 필요가 된 묶음이면 그 선택 실행이다. 생성 중이거나 그런 실행이 없으면 `null`.
 */
function runLine(bundle: MentionBundle): RunLineSnapshot | null {
  if (bundle.status === 'generating') return null;
  /** 실행 줄에 보일 실행. */
  const run = bundle.draft ? bundle.runs.findLast((record) => record.result === 'succeeded') : bundle.status === 'failed' || decidedBySelection(bundle) ? bundle.runs.at(-1) : undefined;
  if (!run) return null;
  return { agent: run.agent, durationMs: Math.max(0, run.finishedAt - run.startedAt), contextOmitted: run.omittedContextItems > 0 };
}

/** 선택 실행의 판정으로 저장소 확인 필요가 된 묶음인지 본다. 마지막 실행 기록이 그 선택 실행이다. */
function decidedBySelection(bundle: MentionBundle): boolean {
  return bundle.status === 'repo-check-needed' && (bundle.repoCheck?.kind === 'unsure' || bundle.repoCheck?.kind === 'unrelated');
}

/**
 * "스레드 보기"로 펼칠 글. 맥락의 게시물 본문 뒤에, 댓글 스레드 묶음이면 대상 댓글 스레드를, 본문 묶음이면 다른 댓글을 잇는다.
 * 댓글 스레드 묶음에서 다른 댓글 스레드는 넣지 않는다. 멘션 표기는 이름만 넘기고 사용자 ID는 넘기지 않는다.
 */
function threadEntries(context: BundleContext): ThreadEntrySnapshot[] {
  /** 게시물, 대상 댓글 스레드, 다른 댓글. */
  const { post, targetThread, otherComments } = context;
  /** 이어 붙일 댓글. */
  const comments = targetThread ? [targetThread] : otherComments;
  return [
    entryOf(post, 'post'),
    ...comments.flatMap((comment) => [entryOf(comment, 'comment'), ...comment.replies.map((reply) => entryOf(reply, 'reply'))]),
  ];
}

/** 맥락의 글 하나를 "스레드 보기"의 글로 바꾼다. */
function entryOf(writing: ContextWriting, place: MentionPlaceSnapshot): ThreadEntrySnapshot {
  return {
    authorName: writing.authorName,
    place,
    at: flowTimeToEpochMs(writing.registeredDateTime),
    text: splitMentionMarkup(writing.contents),
    attachments: [...writing.attachments],
    mention: writing.mention,
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
