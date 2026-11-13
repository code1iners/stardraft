import type { ManualRequestResult, MentionBundles } from '../bundles/mention-bundles';
import { errorFields, type Logger } from '../logging/logger';
import type { Clock } from '../ports/clock';
import type { FlowApiFailure, FlowConnection } from '../ports/flow-api';
import { listRecentMentions, type RecentMention, type RecentMentionCursor } from './recent-mentions';

/** 최근 멘션 목록을 불러오지 못한 까닭. */
export type ManualCheckLoadFailure = 'no-key' | 'unauthorized' | 'network' | 'rate-limited' | 'unexpected';

/** 최근 멘션 확인 목록에 보이는 멘션 하나. */
export interface ManualMentionCandidate extends RecentMention {
  /** 멘션이 온 Flow 프로젝트 이름. 모르면 `null`. */
  projectTitle: string | null;
}

/** 최근 멘션 목록을 한 번 불러온 결과. */
export type ManualMentionList =
  /** 불러왔다. 최신이 앞이고, `next`는 더 보기로 이어 불러올 자리다. 끝이면 `null`. */
  | { ok: true; candidates: ManualMentionCandidate[]; next: RecentMentionCursor | null }
  /** 불러오지 못했다. */
  | { ok: false; reason: ManualCheckLoadFailure };

/** 최근 멘션 확인에 필요한 것. */
export interface ManualMentionCheckOptions {
  /** 고른 멘션으로 수동 요청 묶음을 만들 멘션 묶음. */
  bundles: Pick<MentionBundles, 'requestMention'>;
  /** 지금 키로 Flow 연결을 만든다. 쓸 키가 없으면 `null`. */
  connectFlow: () => FlowConnection | null;
  /** 키 확인 때 얻은 내 사용자 ID. 모르면 `null`. */
  myUserId: () => string | null;
  /** Flow 프로젝트 이름. 모르면 `null`. */
  projectTitle: (projectId: string) => Promise<string | null>;
  /** 멘션을 감지한 시각으로 쓸 시각을 읽는 시계. */
  clock: Clock;
  /** 진단 로그. ID와 개수만 남긴다. */
  logger: Logger;
}

/**
 * 최근 멘션 확인의 멘션 쪽. 감지에서 빠진 멘션까지 최근 멘션을 10건씩 불러오고, 사용자가 고른 멘션을 게시할 수 있는 수동 요청 묶음으로 만든다.
 * 목록 창의 열림·탭·로딩 상태는 화면 쪽이 들고, 여기서는 상태를 두지 않는다.
 */
export class ManualMentionCheck {
  constructor(private readonly options: ManualMentionCheckOptions) {}

  /**
   * 최근 멘션을 `from` 자리부터(없으면 최신부터) 10건까지 불러와 Flow 프로젝트 이름을 붙인다.
   * Flow가 키를 거부하면 "키 확인 필요"로 알린다.
   */
  async listMentions(from: RecentMentionCursor | null): Promise<ManualMentionList> {
    /** 지금 키로 만든 Flow 연결. */
    const flow = this.options.connectFlow();
    /** 내 사용자 ID. */
    const myUserId = this.options.myUserId();
    if (!flow || myUserId === null) return { ok: false, reason: 'no-key' };
    try {
      /** 불러온 결과. */
      const result = await listRecentMentions(flow.api, myUserId, this.options.clock.now(), from);
      if (!result.ok) {
        this.options.logger.warn('manual-check.load-failed', { reason: result.failure.kind });
        if (result.failure.kind === 'unauthorized') flow.reportKeyRejected();
        return { ok: false, reason: loadFailureOf(result.failure.kind) };
      }
      /** Flow 프로젝트마다 찾은 이름. 같은 프로젝트는 한 번만 찾는다. */
      const titles = new Map<string, Promise<string | null>>();
      /** 목록에 보일 멘션. */
      const candidates = await Promise.all(
        result.value.mentions.map(async (recent): Promise<ManualMentionCandidate> => {
          /** 멘션이 온 Flow 프로젝트. */
          const { projectId } = recent.mention;
          if (!titles.has(projectId)) titles.set(projectId, this.options.projectTitle(projectId).catch(() => null));
          return { ...recent, projectTitle: await titles.get(projectId)! };
        }),
      );
      this.options.logger.info('manual-check.loaded', { count: candidates.length, more: result.value.next !== null });
      return { ok: true, candidates, next: result.value.next };
    } catch (error) {
      this.options.logger.error('manual-check.load-crashed', errorFields(error));
      return { ok: false, reason: 'unexpected' };
    }
  }

  /** 목록에서 고른 멘션으로 수동 요청 묶음을 만든다. 그 멘션 위치에 이미 묶음이 있으면 새로 만들지 않고 그 묶음을 돌려준다. */
  async request(candidate: RecentMention): Promise<ManualRequestResult> {
    /** 만들거나 찾은 묶음. */
    const result = await this.options.bundles.requestMention(candidate);
    this.options.logger.info(result.kind === 'created' ? 'manual-check.requested' : 'manual-check.existing', {
      bundleId: result.bundleId,
      alarmId: candidate.mention.alarmId,
    });
    return result;
  }
}

/** Flow 실패의 종류를 불러오지 못한 까닭으로 바꾼다. */
function loadFailureOf(kind: FlowApiFailure['kind']): ManualCheckLoadFailure {
  return kind === 'unauthorized' || kind === 'network' || kind === 'rate-limited' ? kind : 'unexpected';
}
