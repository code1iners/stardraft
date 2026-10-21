import type { FlowAlarm, FlowApi, FlowApiResult } from '../ports/flow-api';
import { compareAlarmIds } from './alarm-id';
import { flowTimeToEpochMs } from './flow-time';
import { walkPages } from './pages';

/** 기준점 뒤에 온 멘션 알림을 모은 결과. */
export interface NewMentionAlarms {
  /** 모은 알림. Flow가 준 순서(최신부터)다. 쪽을 넘기는 사이에 새 알림이 오면 같은 알림이 두 번 들어 있을 수 있다. */
  alarms: FlowAlarm[];
  /** 쪽 수 상한에 닿아 더 오래된 알림을 보지 못하고 멈췄는지 여부. */
  pageLimitReached: boolean;
}

/**
 * 최신 알림부터 쪽을 넘기며 기준점 뒤의 멘션 알림을 모은다.
 * 기준점 이하의 알림, `since`(Unix epoch 밀리초)보다 먼저 온 알림, 마지막 쪽 가운데 하나를 만나면 멈춘다.
 * 알림은 alarmId 내림차순으로 오므로 그 뒤의 알림은 모두 더 오래됐다.
 */
export async function listMentionAlarmsAfter(api: FlowApi, baseline: string, since: number): Promise<FlowApiResult<NewMentionAlarms>> {
  /** 모은 알림. */
  const alarms: FlowAlarm[] = [];
  /** 쪽을 넘긴 결과. */
  const walk = await walkPages(
    (cursor) => api.listMentionAlarms(cursor),
    (page) => {
      for (const alarm of page.alarms) {
        if (compareAlarmIds(alarm.alarmId, baseline) <= 0 || cameBefore(alarm, since)) return false;
        alarms.push(alarm);
      }
      return true;
    },
  );
  return walk.ok ? { ok: true, value: { alarms, pageLimitReached: walk.pageLimitReached } } : walk;
}

/** 알림이 `since`보다 먼저 왔는지 본다. 시각을 읽을 수 없으면 범위 안으로 본다. */
function cameBefore(alarm: FlowAlarm, since: number): boolean {
  /** 알림 시각. */
  const at = flowTimeToEpochMs(alarm.registeredDateTime);
  return at !== null && at < since;
}
