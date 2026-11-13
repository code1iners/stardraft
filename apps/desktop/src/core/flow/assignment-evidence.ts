import type { FlowAlarm, FlowComment, FlowEmployee, FlowPost, FlowTask } from '../ports/flow-api';
import { compareRemarks } from './bundle-context';
import { isSameFlowUser } from './user-id';
import { parseWorkerChange, WORKER_CHANGE_CODE } from './worker-change';

/** 본문 생성 알림과 서버 시각이 같고 생성 후 수정이 없는지, 곧 생성 시 지정인지 본다. 기능 시작 시각과의 비교는 쓰는 쪽이 한다. */
export function isCreationAssignment(alarm: FlowAlarm, post: FlowPost): boolean {
  return alarm.remarkId === '-1' && alarm.replyId === '-1'
    && alarm.registeredDateTime === post.registeredDateTime && post.editedDateTime === post.registeredDateTime;
}

/**
 * 생성 후 지정의 배정 시각. 담당 변경 기록은 표시 이름만 주므로 현재 사용자 ID와 교차 확인한다.
 * 마지막 담당 변경까지 내 이름이 이어져 있고, 내 이름이 처음 들어간 기록이 하나로 정해지며,
 * 현재 담당자 가운데 내 이름이 나 하나뿐일 때만 그 기록의 서버 시각을 돌려준다. 형식 이상·동명이인·이름 불일치는 `null`이다.
 * 과거에 내가 이름을 바꾼 경우는 구별하지 못한다.
 */
export function laterAssignmentTime(comments: readonly FlowComment[], task: FlowTask, account: FlowEmployee): string | null {
  /** 내 현재 표시 이름. */
  const myName = account.name.trim();
  /** 현재 담당자 가운데 내 이름을 쓰는 사람. */
  const sameName = task.workerNames?.filter((worker) => worker.name === myName) ?? [];
  if (!myName || sameName.length !== 1 || !isSameFlowUser(sameName[0]!.userId, account.userId)) return null;
  /** 담당 변경 기록. 오래된 것부터다. */
  const changes = comments.filter((comment) => comment.systemCode.split('^^')[0] === WORKER_CHANGE_CODE)
    .sort(compareRemarks((comment) => comment.commentId));
  for (let index = changes.length - 1; index >= 0; index -= 1) {
    /** 해석한 기록. */
    const change = parseWorkerChange(changes[index]!.systemCode);
    // 최신 기록부터 거슬러 오르며, 내 이름이 이후 담당자에 정확히 한 번 이어지는지 본다.
    if (!change || change.after.filter((name) => name === myName).length !== 1) return null;
    /** 이전 담당자 가운데 내 이름 수. */
    const before = change.before.filter((name) => name === myName).length;
    // 이전에 없던 기록이 나를 추가한 기록이다. 이전에도 여럿이면 누구인지 정할 수 없다.
    if (before === 0) return changes[index]!.registeredDateTime || null;
    if (before > 1) return null;
  }
  return null;
}
