import { useState } from 'react';
import { PARALLEL_WORK_COUNT_MAX, PARALLEL_WORK_COUNT_MIN, type ParallelWorkSnapshot } from '../../shared/ipc';
import { HelpTip } from './HelpTip';

/** 표 첫 줄 "초안 · 진단"의 설명. */
const ALL_WORK_TIP = '연결한 모든 서비스의 초안과 진단을 합친 수입니다.';
/** 표 둘째 줄 "재현하는 진단"의 설명. */
const REPRODUCTION_TIP = '재현을 허용한 저장소의 진단입니다. 시뮬레이터와 포트를 함께 써서 한 번에 하나만 진행합니다.';

/** `병렬 작업` 탭에 넘기는 값. */
interface ParallelWorkPanelProps {
  /** 고른 병렬 작업 수와 진행 중인 수. */
  parallelWork: ParallelWorkSnapshot;
}

/**
 * 설정 "에이전트" 칸의 `병렬 작업` 탭. 항목 "병렬 작업 수" 하나다.
 * 슬라이더를 움직이는 즉시 저장하고, main은 돌던 실행을 그대로 두고 다음 실행을 꺼낼 때부터 새 값을 쓴다.
 * 진행 중인 작업이 고른 값보다 많을 때만 노란 띠로 알린다.
 */
export function ParallelWorkPanel({ parallelWork }: ParallelWorkPanelProps) {
  /**
   * 움직였지만 아직 저장 결과가 돌아오지 않은 값과, 움직일 때 스냅숏의 값. 스냅숏 값이 바뀌면(저장됨, 다른 창에서 바꿈) 버리고 스냅숏을 따른다.
   */
  const [moved, setMoved] = useState<{ value: number; base: number } | null>(null);
  /** 슬라이더에 보일 값. 저장이 끝나기 전에도 움직인 값을 바로 보인다. */
  const count = moved !== null && moved.base === parallelWork.count ? moved.value : parallelWork.count;

  /** 고른 값을 보이고 저장한다. */
  const handleChange = (value: number) => {
    setMoved({ value, base: parallelWork.count });
    void window.stardraft.send({ type: 'set-parallel-work-count', count: value });
  };

  return (
    <div className="field">
      <label className="field-label" htmlFor="parallel-work-count">
        병렬 작업 수
      </label>
      <p className="field-help muted">올리면 사용량 한도를 더 빨리 씁니다.</p>
      <div className="slider-row">
        <input
          id="parallel-work-count"
          className="slider"
          type="range"
          min={PARALLEL_WORK_COUNT_MIN}
          max={PARALLEL_WORK_COUNT_MAX}
          step={1}
          value={count}
          aria-valuetext={`${count}개`}
          onChange={(event) => handleChange(Number(event.target.value))}
        />
        <span className="slider-value" aria-hidden="true">
          {count}개
        </span>
      </div>
      <table className="limit-table">
        <tbody>
          <tr>
            <td>
              초안 · 진단
              <HelpTip name="초안 · 진단" text={ALL_WORK_TIP} />
            </td>
            <td>최대 {count}개</td>
          </tr>
          <tr>
            <td>
              재현하는 진단
              <HelpTip name="재현하는 진단" text={REPRODUCTION_TIP} />
            </td>
            <td>그중 1개</td>
          </tr>
        </tbody>
      </table>
      {parallelWork.running > count && (
        <p className="pending-band" role="status">
          진행 중인 {parallelWork.running}개가 끝나면 {count}개로 맞춥니다.
        </p>
      )}
    </div>
  );
}
