import { describe, expect, it } from 'vitest';
import { EXAMPLE_SCENES, exampleTarget, pressExample, startExample, type ExampleSceneId, type ExampleState } from './example-scenes';

/** 처음 상태에서 누를 곳을 차례로 누른다. */
function pressAll(scene: ExampleSceneId, targets: string[]): ExampleState {
  return targets.reduce((state, target) => pressExample(scene, state, target), startExample());
}

describe('예시 화면의 상태 전환', () => {
  it('"열지 않음" 창에서 완료를 누르면 창이 닫히고 더 누를 곳이 없다', () => {
    const start = startExample();
    expect(exampleTarget('mac-blocked', start)).toBe('done');

    const closed = pressExample('mac-blocked', start, 'done');

    expect(closed).toEqual({ phase: 'closed', warning: null });
    expect(exampleTarget('mac-blocked', closed)).toBeNull();
  });

  it('휴지통으로 이동을 누르면 상태는 그대로이고 경고를 띄운다', () => {
    const state = pressExample('mac-blocked', startExample(), 'trash');

    expect(state.phase).toBe(startExample().phase);
    expect(state.warning).toBe('실제 창에서는 누르지 마세요. 앱이 휴지통으로 갑니다.');
  });

  it('경고 뒤에 누를 곳을 누르면 경고가 사라지고 넘어간다', () => {
    const warned = pressExample('mac-blocked', startExample(), 'trash');

    expect(pressExample('mac-blocked', warned, 'done')).toEqual({ phase: 'closed', warning: null });
  });

  it('Windows의 PC 보호: 추가 정보 → 실행 순서로 넘어가고, 실행 안 함은 어느 상태에서든 경고한다', () => {
    const start = startExample();
    expect(exampleTarget('win-smartscreen', start)).toBe('more');
    expect(pressExample('win-smartscreen', start, 'run')).toBe(start);
    expect(pressExample('win-smartscreen', start, 'dont-run').warning).toBe(
      '실행 안 함을 누르면 설치가 멈춥니다. 설치 파일을 다시 열면 이 창이 다시 뜹니다.',
    );

    const more = pressExample('win-smartscreen', start, 'more');
    expect(exampleTarget('win-smartscreen', more)).toBe('run');
    expect(pressExample('win-smartscreen', more, 'dont-run').warning).not.toBeNull();

    expect(exampleTarget('win-smartscreen', pressExample('win-smartscreen', more, 'run'))).toBeNull();
  });

  it('한 번 더 확인하는 창에서 완료를 누르면 열리지 않는다고 경고하고, 그래도 열기 → 암호 확인으로 켜진다', () => {
    expect(pressExample('mac-confirm', startExample(), 'done').warning).toBe(
      '완료를 누르면 열리지 않습니다. 시스템 설정에서 그래도 열기를 다시 누르세요.',
    );

    expect(pressAll('mac-confirm', ['open', 'ok'])).toEqual({ phase: 'opened', warning: null });
  });

  it('누를 수 없는 곳을 누르면 아무 일도 없다', () => {
    const start = startExample();

    expect(pressExample('mac-dmg', start, 'nothing')).toBe(start);
  });

  it('처음부터는 첫 상태로 되돌린다', () => {
    const done = pressAll('win-done', ['chevron']);

    expect(done.phase).not.toBe(startExample().phase);
    expect(startExample()).toEqual({ phase: 'start', warning: null });
  });

  it('모든 예시 화면은 누를 곳만 따라 누르면 누를 곳 없는 마지막 모습에 닿는다', () => {
    for (const scene of Object.keys(EXAMPLE_SCENES) as ExampleSceneId[]) {
      let state = startExample();
      for (let step = 0; step < 10 && exampleTarget(scene, state); step++) {
        state = pressExample(scene, state, exampleTarget(scene, state)!);
      }

      expect(exampleTarget(scene, state), scene).toBeNull();
      expect(state.warning, scene).toBeNull();
    }
  });
});
