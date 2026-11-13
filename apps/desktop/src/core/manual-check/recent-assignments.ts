import type { AssignmentState } from '../detection/assignment-detection';
import { isCreationAssignment, laterAssignmentTime } from '../flow/assignment-evidence';
import { flowTimeToEpochMs } from '../flow/flow-time';
import type { MyAnswer } from '../flow/mention-judgement';
import { taskAnswers, taskRemarks } from '../flow/task-remarks';
import { isSameFlowUser } from '../flow/user-id';
import type { FlowAlarm, FlowApi, FlowApiResult, FlowEmployee, FlowPost } from '../ports/flow-api';
import { collectFromAlarms, type AlarmVerdict, type AlarmWalkCursor } from './alarm-walk';
import { answeredAfter } from './recent-mentions';

/**
 * 담당 업무 감지가 이 업무를 자동으로 가져오지 않은 까닭. 최근 멘션 확인에서는 풀어 주고 줄 태그로 보인다.
 * 기능 시작 전 업무, 기능 시작 전 배정, 자기 작성 업무, 배정 근거 없음이다.
 */
export type AssignmentMissReason = 'pre-feature-task' | 'pre-feature-assignment' | 'self-authored' | 'no-evidence';

/** 최근 멘션 확인의 담당 업무 목록에서 고를 수 있는 업무 하나. 묶음 자리는 게시글 본문이다. */
export interface RecentAssignment {
  /** 이 게시글에 온 가장 최근 WORKER 알림. */
  alarm: FlowAlarm;
  /** 목록을 만들 때 조회한 게시글 상세. 업무는 하나뿐이고 내가 담당자인 요청 상태다. */
  post: FlowPost;
  /** 게시글의 업무 ID. 게시글 ID와 다르다. */
  taskId: string;
  /** 배정 시각. Flow 형식(`yyyyMMddHHmmss`)이다. 근거가 있으면 그 서버 시각이고, 없으면 알림 시각이다. */
  assignedAt: string;
  /** `assignedAt`이 근거 없이 알림 시각으로 대신한 추정인지 여부. */
  assignedAtEstimated: boolean;
  /** 업무 댓글·대댓글 가운데 내 글. 시스템 기록은 넣지 않는다. */
  answers: MyAnswer[];
  /** 배정 시각보다 나중에 쓴 내 글이 있는지 여부. 목록에 "답함"을 붙이지만 고를 수는 있다. */
  answered: boolean;
  /** 감지에서 빠진 이유. 없으면 빈 배열이다. */
  missReasons: AssignmentMissReason[];
}

/** 이어 불러오기가 시작할 자리. 앞선 불러오기가 돌려준 값을 그대로 넘긴다. 판정한 자리는 게시글 ID다. */
export type RecentAssignmentCursor = AlarmWalkCursor;

/** 담당 업무 목록의 한 번 불러온 몫. */
export interface RecentAssignmentPage {
  /** 모은 업무. 최신 알림이 앞이다. */
  assignments: RecentAssignment[];
  /** 이어 불러올 자리. 알림 끝에 닿았으면 `null`. */
  next: RecentAssignmentCursor | null;
}

/**
 * 최근 WORKER 알림을 최신부터(`from`이 있으면 그 자리부터) 넘기며 게시글마다 가장 최근 알림 하나를 남기고, 게시글 상세를 조회해 후보를 `MANUAL_CHECK_PAGE_SIZE`건까지 모은다.
 * 후보는 내 계정에 온 알림이고, 업무가 하나뿐이며, 내가 담당자인 요청 상태 업무다. 감지와 달리 기능 시작 전 업무·배정, 자기 작성 업무, 배정 근거 없음도
 * 후보로 두고 그 까닭을 `missReasons`에 남긴다. Flow의 읽음 상태는 바꾸지 않는다.
 * `account`는 키 확인 때 얻은 내 구성원 정보, `state`는 담당 업무 감지 상태다. 다른 계정의 상태이거나 없으면 기능 시작 전 여부를 따지지 않는다.
 */
export async function listRecentAssignments(
  api: FlowApi,
  account: FlowEmployee,
  state: AssignmentState | null,
  from: RecentAssignmentCursor | null = null,
): Promise<FlowApiResult<RecentAssignmentPage>> {
  /** 이 계정의 담당 업무 감지 상태. */
  const mine = state && isSameFlowUser(state.accountId, account.userId) ? state : null;
  /** 쪽을 넘기며 후보를 모은 결과. */
  const walk = await collectFromAlarms(
    (cursor) => api.listWorkerAlarms(cursor),
    from,
    // 다른 계정에 온 알림은 판정하지 않는다. 그 게시글의 내 알림이 뒤에 있으면 그것으로 판정한다.
    (alarm) => (alarm.receiverId && !isSameFlowUser(alarm.receiverId, account.userId) ? null : alarm.postId),
    (alarm) => judgeAssignment(api, account, mine, alarm),
  );
  if (!walk.ok) return walk;
  return { ok: true, value: { assignments: walk.value.found, next: walk.value.next } };
}

/** 게시글 하나의 가장 최근 WORKER 알림으로 그 업무가 후보인지 판정한다. 상세나 댓글을 받지 못하면 그 실패를 돌려준다. */
async function judgeAssignment(
  api: FlowApi,
  account: FlowEmployee,
  state: AssignmentState | null,
  alarm: FlowAlarm,
): Promise<AlarmVerdict<RecentAssignment>> {
  /** 최신 상세. 작성자와 업무, 담당자, 상태를 본다. */
  const detail = await api.getPost(alarm.postId);
  if (!detail.ok) return { kind: 'failed', failure: detail.failure };
  /** 방금 조회한 게시글. */
  const post = detail.value;
  /** 게시글의 유일한 업무. 업무가 여럿이면 어느 업무에 대한 배정인지 모호해 후보가 아니다. */
  const task = post.tasks?.length === 1 ? post.tasks[0]! : undefined;
  if (post.postId !== alarm.postId || !task?.taskId || !task.workerIds?.some((id) => isSameFlowUser(id, account.userId))) return { kind: 'skip' };
  // 진행·피드백·보류·완료와 읽지 못한 상태는 답이 필요한 요청이 아니다.
  if (task.completion !== 'active') return { kind: 'skip' };
  /** 배정 근거와 "답함"을 판정할 업무의 댓글·대댓글 전부. */
  const remarks = await taskRemarks(api, post.postId);
  if (!remarks.ok) return { kind: 'failed', failure: remarks.failure };
  // 쪽 상한에 닿아 끝까지 받지 못한 기록에서는 마지막 담당 변경을 알 수 없으므로 담당 변경 기록을 근거로 쓰지 않는다.
  /** 배정 시점 근거. 가장 최근에 나를 더한 담당 변경 기록이 앞서고, 없으면 생성 시 지정이다. */
  const evidence = (remarks.value.complete ? laterAssignmentTime(remarks.value.comments, task, account) : null)
    ?? (isCreationAssignment(alarm, post) ? post.registeredDateTime : null);
  /** 배정 시각. 근거가 없으면 알림 시각으로 대신한다. */
  const assignedAt = evidence ?? alarm.registeredDateTime;
  /** 배정 근거의 시각을 기능 시작 시각과 견줄 값. */
  const evidenceAt = evidence === null ? null : flowTimeToEpochMs(evidence);
  /** 감지에서 빠진 이유. 감지가 거르는 순서대로 둔다. */
  const missReasons: AssignmentMissReason[] = [
    ...(state?.initialPostIds.includes(post.postId) ? ['pre-feature-task' as const] : []),
    ...(state && evidenceAt !== null && evidenceAt <= state.enabledAt ? ['pre-feature-assignment' as const] : []),
    ...(post.registerId && isSameFlowUser(post.registerId, account.userId) ? ['self-authored' as const] : []),
    ...(evidence === null ? ['no-evidence' as const] : []),
  ];
  /** 업무에 쓴 내 글. 이 알림을 받은 ID도 내 ID로 본다. */
  const answers = taskAnswers(remarks.value, [account.userId, ...(alarm.receiverId ? [alarm.receiverId] : [])]);
  return {
    kind: 'found',
    value: {
      alarm,
      post,
      taskId: task.taskId,
      assignedAt,
      assignedAtEstimated: evidence === null,
      answers,
      answered: answeredAfter(assignedAt, answers),
      missReasons,
    },
  };
}
