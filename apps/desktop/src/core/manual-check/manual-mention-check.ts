import type { ManualRequestResult, MentionBundles } from '../bundles/mention-bundles';
import type { AssignmentState } from '../detection/assignment-detection';
import { errorFields, type Logger } from '../logging/logger';
import type { Clock } from '../ports/clock';
import type { FlowApiFailure, FlowApiResult, FlowConnection, FlowEmployee } from '../ports/flow-api';
import { listRecentAssignments, type RecentAssignment, type RecentAssignmentCursor } from './recent-assignments';
import { listRecentMentions, type RecentMention, type RecentMentionCursor } from './recent-mentions';

/** 최근 멘션이나 담당 업무 목록을 불러오지 못한 까닭. */
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

/** 최근 멘션 확인 목록에 보이는 담당 업무 하나. */
export interface ManualAssignmentCandidate extends RecentAssignment {
  /** 업무가 있는 Flow 프로젝트 이름. 모르면 `null`. */
  projectTitle: string | null;
}

/** 담당 업무 목록을 한 번 불러온 결과. */
export type ManualAssignmentList =
  /** 불러왔다. 최신 알림이 앞이고, `next`는 더 보기로 이어 불러올 자리다. 끝이면 `null`. */
  | { ok: true; candidates: ManualAssignmentCandidate[]; next: RecentAssignmentCursor | null }
  /** 불러오지 못했다. */
  | { ok: false; reason: ManualCheckLoadFailure };

/** 최근 멘션 확인에 필요한 것. */
export interface ManualMentionCheckOptions {
  /** 고른 멘션이나 담당 업무로 수동 요청 묶음을 만들 멘션 묶음. */
  bundles: Pick<MentionBundles, 'requestMention' | 'requestAssignment'>;
  /** 지금 키로 Flow 연결을 만든다. 쓸 키가 없으면 `null`. */
  connectFlow: () => FlowConnection | null;
  /** 키 확인 때 얻은 내 구성원 정보. 모르면 `null`. */
  account: () => FlowEmployee | null;
  /** 담당 업무 감지 상태. 감지를 한 적 없으면 `null`. */
  assignmentState: () => Promise<AssignmentState | null>;
  /** Flow 프로젝트 이름. 모르면 `null`. */
  projectTitle: (projectId: string) => Promise<string | null>;
  /** 멘션을 감지한 시각으로 쓸 시각을 읽는 시계. */
  clock: Clock;
  /** 진단 로그. ID와 개수만 남긴다. */
  logger: Logger;
}

/**
 * 최근 멘션 확인. 감지에서 빠진 멘션과 담당 업무까지 최근 항목을 10건씩 불러오고, 사용자가 고른 멘션이나 담당 업무를 게시할 수 있는 수동 요청 묶음으로 만든다.
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
    /** 내 구성원 정보. */
    const account = this.options.account();
    if (!flow || !account) return { ok: false, reason: 'no-key' };
    /** 불러온 결과. */
    const loaded = await this.load('mentions', flow, () => listRecentMentions(flow.api, account.userId, this.options.clock.now(), from),
      (page) => ({ count: page.mentions.length, more: page.next !== null }));
    if (!loaded.ok) return loaded;
    /** 목록에 보일 멘션. */
    const candidates = await this.withProjectTitles(loaded.value.mentions, (recent) => recent.mention.projectId);
    return { ok: true, candidates, next: loaded.value.next };
  }

  /**
   * 내가 담당자인 요청 상태 업무를 최근 WORKER 알림에서 `from` 자리부터(없으면 최신부터) 10건까지 불러와 Flow 프로젝트 이름을 붙인다.
   * 감지에서 빠진 업무도 넣고 그 까닭을 함께 돌려준다. Flow가 키를 거부하면 "키 확인 필요"로 알린다.
   */
  async listAssignments(from: RecentAssignmentCursor | null): Promise<ManualAssignmentList> {
    /** 지금 키로 만든 Flow 연결. */
    const flow = this.options.connectFlow();
    /** 내 구성원 정보. */
    const account = this.options.account();
    if (!flow || !account) return { ok: false, reason: 'no-key' };
    /** 불러온 결과. */
    const loaded = await this.load('assignments', flow, async () =>
      listRecentAssignments(flow.api, account, await this.options.assignmentState(), from),
    (page) => ({ count: page.assignments.length, more: page.next !== null }));
    if (!loaded.ok) return loaded;
    /** 목록에 보일 업무. */
    const candidates = await this.withProjectTitles(loaded.value.assignments, (recent) => recent.alarm.projectId);
    return { ok: true, candidates, next: loaded.value.next };
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

  /** 목록에서 고른 담당 업무로 수동 요청 묶음을 만든다. 그 업무의 본문 자리에 이미 묶음이 있으면 새로 만들지 않고 그 묶음을 돌려준다. */
  async requestAssignment(candidate: RecentAssignment): Promise<ManualRequestResult> {
    /** 만들거나 찾은 묶음. */
    const result = await this.options.bundles.requestAssignment(candidate);
    this.options.logger.info(result.kind === 'created' ? 'manual-check.requested' : 'manual-check.existing', {
      bundleId: result.bundleId,
      alarmId: candidate.alarm.alarmId,
    });
    return result;
  }

  /**
   * `list`로 `kind` 목록을 불러온다. 실패하면 불러오지 못한 까닭으로 바꾸고, Flow가 키를 거부했으면 "키 확인 필요"로 알린다.
   * 진단 로그에는 `summary`로 얻은 개수와 더 있는지만 남긴다.
   */
  private async load<T>(
    kind: 'mentions' | 'assignments',
    flow: FlowConnection,
    list: () => Promise<FlowApiResult<T>>,
    summary: (value: T) => { count: number; more: boolean },
  ): Promise<{ ok: true; value: T } | { ok: false; reason: ManualCheckLoadFailure }> {
    try {
      /** 불러온 결과. */
      const result = await list();
      if (!result.ok) {
        this.options.logger.warn('manual-check.load-failed', { kind, reason: result.failure.kind });
        if (result.failure.kind === 'unauthorized') flow.reportKeyRejected();
        return { ok: false, reason: loadFailureOf(result.failure.kind) };
      }
      this.options.logger.info('manual-check.loaded', { kind, ...summary(result.value) });
      return { ok: true, value: result.value };
    } catch (error) {
      this.options.logger.error('manual-check.load-crashed', { kind, ...errorFields(error) });
      return { ok: false, reason: 'unexpected' };
    }
  }

  /** 항목마다 Flow 프로젝트 이름을 붙인다. 같은 프로젝트는 한 번만 찾고, 찾지 못하면 `null`이다. */
  private async withProjectTitles<T>(items: readonly T[], projectIdOf: (item: T) => string): Promise<(T & { projectTitle: string | null })[]> {
    /** Flow 프로젝트마다 찾은 이름. */
    const titles = new Map<string, Promise<string | null>>();
    return Promise.all(
      items.map(async (item) => {
        /** 항목이 있는 Flow 프로젝트. */
        const projectId = projectIdOf(item);
        if (!titles.has(projectId)) titles.set(projectId, this.options.projectTitle(projectId).catch(() => null));
        return { ...item, projectTitle: await titles.get(projectId)! };
      }),
    );
  }
}

/** Flow 실패의 종류를 불러오지 못한 까닭으로 바꾼다. */
function loadFailureOf(kind: FlowApiFailure['kind']): ManualCheckLoadFailure {
  return kind === 'unauthorized' || kind === 'network' || kind === 'rate-limited' ? kind : 'unexpected';
}
