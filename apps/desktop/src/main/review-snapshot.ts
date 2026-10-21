import { activeMentions, isRestorable, listGroupOf, type MentionBundle } from '../core/bundles/mention-bundle';
import { flowTimeToEpochMs } from '../core/flow/flow-time';
import { splitMentionMarkup } from '../core/flow/mention-markup';
import { isPostBody, mentionPlaceOf } from '../core/flow/mention-place';
import type { BundleMentionSnapshot, BundleSnapshot, ReviewSnapshot } from '../shared/ipc';

/** 참여 목록에서 찾은 Flow 프로젝트. */
export interface FlowProjectInfo {
  /** Flow 프로젝트 이름. */
  title: string;
  /** Flow 프로젝트 주소. 없으면 `null`. */
  projectUrl: string | null;
}

/** Flow 프로젝트 ID로 참여 목록의 프로젝트를 찾는다. 목록을 아직 받지 않았거나 없으면 `null`. */
export type ProjectLookup = (projectId: string) => FlowProjectInfo | null;

/** 작은 창과 펼친 창이 그릴 묶음 상태. `bundles`는 대기열 순서 그대로 넘긴다. */
export function reviewSnapshot(
  bundles: readonly MentionBundle[],
  sections: ReviewSnapshot['sections'],
  projectOf: ProjectLookup,
): ReviewSnapshot {
  return {
    bundles: bundles.map((bundle) => bundleSnapshot(bundle, projectOf)),
    sections: { compact: { ...sections.compact }, expanded: { ...sections.expanded } },
  };
}

/**
 * 묶음 하나를 렌더러에 넘길 모양으로 바꾼다. Flow 사용자 ID와 주소는 넘기지 않는다.
 * 원문 영역에는 묶음에 남은 멘션을 보이고, 모든 멘션이 빠진 이미 답함 묶음이면 빠진 멘션을 보인다.
 */
export function bundleSnapshot(bundle: MentionBundle, projectOf: ProjectLookup): BundleSnapshot {
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
