import type { MentionBundles } from '../bundles/mention-bundles';
import { compareAlarmIds } from '../flow/alarm-id';
import { flowTimeToEpochMs } from '../flow/flow-time';
import { isSameFlowUser } from '../flow/user-id';
import type { Clock } from '../ports/clock';
import type { FlowAlarm, FlowConnection } from '../ports/flow-api';
import type { StateStore } from '../ports/state-store';

/** 계정별 담당 업무 감지 상태. 보류는 성공이나 제외로 기록하지 않는다. */
export interface AssignmentState {
  /** 이 기록의 계정. */
  accountId: string;
  /** 기능을 처음 시작한 시각. 조회 실패나 재시작 때 옮기지 않는다. */
  enabledAt: number;
  /** 최초 후보 목록을 끝까지 받았는지 여부. */
  baselineReady: boolean;
  /** 완전히 받은 목록의 최신 알림 ID. */
  baselineAlarmId: string | null;
  /** 기능 시작 전 알림에 나타난 업무 게시글. */
  initialPostIds: string[];
  /** 판별하지 못한 후보. 다음 조회에서 다시 확인한다. */
  pending: FlowAlarm[];
  /** 호출량 상한이나 실패 때문에 끝내지 못한 순회. 기준점과 분리한다. */
  scan?: {
    /** 다음에 받을 커서. */
    cursor: string | null;
    /** 이미 받은 후보. */
    alarms: FlowAlarm[];
    /** 반복 커서를 구별할 이전 커서. */
    cursors: string[];
    /** 순회 시작 첫 쪽의 최신 알림. 조회 중 새 알림이 끼어도 기준이 뛰지 않는다. */
    headAlarmId: string | null;
  };
}

/** 기존 감지 주기에서 사용하는 담당 업무 감지 의존성. */
export interface AssignmentDetectionOptions {
  /** 계정별 기준과 최초 처리 기록. */
  stateStore: StateStore;
  /** 기존 초안 대기열 입구. */
  bundles: MentionBundles;
  /** 활성화 시각. */
  clock: Clock;
  /** 현재 계정의 연결. */
  connectFlow: () => FlowConnection | null;
}

/** WORKER는 후보 발견에만 쓰며, 불명확한 후보는 재조회한다. */
export class AssignmentDetection {
  /** 겹치는 주기와 수동 조회를 합친다. */
  private running: Promise<void> | null = null;
  constructor(private readonly options: AssignmentDetectionOptions) {}

  /** 현재 후보를 조회하고 확정된 생성 시 지정만 대기열에 넣는다. */
  checkNow(): Promise<void> {
    this.running ??= this.poll().finally(() => { this.running = null; });
    return this.running;
  }

  private async poll(): Promise<void> {
    /** 조회 시작 시 계정과 연결을 고정한다. */
    const account = await this.options.stateStore.getAccount();
    /** 이번 계정으로 만든 연결. */
    const flow = this.options.connectFlow();
    if (!account || !flow) return;
    /** 계정 전환 중 끝난 조회는 새 계정에 쓰지 않는다. */
    const current = async () => (await this.options.stateStore.getAccount())?.userId === account.userId;
    /** 기존 기록이 없으면 최초 활성화 시각부터 먼저 남긴다. */
    const saved = await this.options.stateStore.getAssignmentState();
    /** 조회 중 실패해도 유지할 활성화 기준. */
    const state: AssignmentState = saved?.accountId === account.userId ? saved : {
      accountId: account.userId, enabledAt: this.options.clock.now(), baselineReady: false,
      baselineAlarmId: null, initialPostIds: [], pending: [],
    };
    await this.options.stateStore.setAssignmentState(state);
    /** 이번 목록이 끝날 때까지 기준점을 옮기지 않는다. */
    const alarms: FlowAlarm[] = state.scan?.alarms ?? [];
    /** 이번 순회에서 이미 지난 커서. */
    const cursors = new Set<string>(state.scan?.cursors ?? []);
    /** 실패하거나 상한에 닿았던 위치부터 이어 받는다. */
    let cursor: string | null = state.scan?.cursor ?? null;
    /** 첫 쪽에서 고정한 이번 순회의 상한. */
    let headAlarmId = state.scan?.headAlarmId ?? null;
    /** 끝까지 받았거나 기존 기준점에 도달했는지 여부. */
    let complete = false;
    for (let page = 0; page < 50; page += 1) {
      /** 읽은 알림도 포함한 후보 한 쪽. */
      const result = await flow.api.listWorkerAlarms(cursor);
      if (!result.ok) {
        if (result.failure.kind === 'unauthorized') flow.reportKeyRejected();
        state.scan = { cursor, alarms, cursors: [...cursors], headAlarmId };
        await this.options.stateStore.setAssignmentState(state);
        return;
      }
      if (headAlarmId === null) {
        headAlarmId = result.value.alarms.reduce<string | null>((latest, alarm) => latest === null || compareAlarmIds(alarm.alarmId, latest) > 0 ? alarm.alarmId : latest, null);
      }
      alarms.push(...result.value.alarms.filter((alarm) => (!state.baselineAlarmId || compareAlarmIds(alarm.alarmId, state.baselineAlarmId) > 0)
        && (headAlarmId === null || compareAlarmIds(alarm.alarmId, headAlarmId) <= 0)));
      if (result.value.nextCursor === null || (state.baselineAlarmId && result.value.alarms.some((alarm) => compareAlarmIds(alarm.alarmId, state.baselineAlarmId!) <= 0))) {
        complete = true;
        break;
      }
      cursor = result.value.nextCursor;
      if (cursors.has(cursor)) {
        delete state.scan;
        await this.options.stateStore.setAssignmentState(state);
        return;
      }
      cursors.add(cursor);
    }
    if (!(await current())) return;
    if (!complete) {
      state.scan = { cursor, alarms, cursors: [...cursors], headAlarmId };
      await this.options.stateStore.setAssignmentState(state);
      return;
    }
    delete state.scan;
    /** 같은 게시글의 후보는 가장 이른 알림을 남긴다. */
    const candidates = new Map(state.pending.map((alarm) => [alarm.postId, alarm]));
    for (const alarm of alarms.sort((a, b) => compareAlarmIds(a.alarmId, b.alarmId))) {
      if (alarm.receiverId && !isSameFlowUser(alarm.receiverId, account.userId)) continue;
      /** 기능 시작 전 담당 업무 알림은 초기 상태로 저장한다. */
      const at = flowTimeToEpochMs(alarm.registeredDateTime);
      if (!state.baselineReady && at !== null && at <= state.enabledAt) {
        if (!state.initialPostIds.includes(alarm.postId)) state.initialPostIds.push(alarm.postId);
      } else if (!candidates.has(alarm.postId)) candidates.set(alarm.postId, alarm);
    }
    state.baselineReady = true;
    for (const alarm of alarms) {
      if (!state.baselineAlarmId || compareAlarmIds(alarm.alarmId, state.baselineAlarmId) > 0) state.baselineAlarmId = alarm.alarmId;
    }
    state.pending = [...candidates.values()];
    await this.options.stateStore.setAssignmentState(state);
    for (const alarm of state.pending.slice()) {
      if (!(await current())) return;
      /** 최신 상세에서 작성자와 현재 담당자, 상태를 확인한다. */
      const result = await flow.api.getPost(alarm.postId);
      if (!result.ok) {
        if (result.failure.kind === 'unauthorized') { flow.reportKeyRejected(); return; }
        continue;
      }
      /** 방금 조회한 업무 본문. */
      const post = result.value;
      if (post.postId !== alarm.postId) continue;
      /** 기존 업무를 새 업무로 오인하지 않는 생성 시각 경계. */
      const createdAt = flowTimeToEpochMs(post.registeredDateTime);
      /** 게시글에 업무가 여럿이면 어떤 배정인지 확정하지 않는다. */
      const task = post.tasks?.length === 1 ? post.tasks[0] : undefined;
      if (!post.registerId || createdAt === null || !task?.taskId || task.workerIds === null) continue;
      /** 기존 업무의 신규 배정은 후속 티켓 대상이므로 보류한다. */
      if (createdAt <= state.enabledAt || state.initialPostIds.includes(post.postId)) continue;
      if (isSameFlowUser(post.registerId, account.userId)) {
        state.pending = state.pending.filter((item) => item.postId !== post.postId);
        continue;
      }
      // 본문 생성 알림과 서버 시각이 같고 생성 후 수정이 없는 후보만 처리한다.
      // 일반 댓글이나 담당 변경 알림의 시각을 배정 시각으로 대체하지 않는다.
      if (alarm.remarkId !== '-1' || alarm.replyId !== '-1' || alarm.registeredDateTime !== post.registeredDateTime
        || post.editedDateTime !== post.registeredDateTime || !task.workerIds.some((id) => isSameFlowUser(id, account.userId))
        || task.completion === 'unknown') continue;
      if (task.completion === 'active' && await current()) await this.options.bundles.addAssignment(post, alarm.projectId, task.taskId, account.userId);
      state.pending = state.pending.filter((item) => item.postId !== post.postId);
    }
    await this.options.stateStore.setAssignmentState(state);
  }
}
