import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from 'react';
import { pressExample, startExample, type ExampleSceneId, type ExampleState } from '../lib/example-scenes';
import { planCursor, readReducedMotion, watchReducedMotion, type Point } from '../lib/motion';
import type { Screenshot } from '../lib/screenshots';
import { ExampleScene, SCENE_CAPTIONS } from './ExampleScene';

/** 예시 화면 위의 노란 띠 문구. */
export const EXAMPLE_BAND = '예시 화면 · 눌러 볼 수 있지만 실제 창이 아닙니다';

/** 예시 화면이 이만큼 보이면 커서를 움직인다. */
const SEEN_RATIO = 0.6;

/** 틀 안에 보일 것. 실제 스크린숏이 있으면 그것이 기본이다. */
type FrameView = 'shot' | 'example';

/** 실제 스크린숏. */
type ShotProps = {
  /** 스크린숏 이미지. 아직 찍지 않았으면 null이고, 그때는 예시 화면만 보인다. */
  image: Screenshot | null;
  /** 이미지의 대체 글. */
  alt: string;
  /** 스크린숏 밑에 붙이는 누를 곳 안내. */
  caption: ReactNode;
};

/** 예시 화면 틀이 받는 것. */
type Props = {
  /** 장면 이름. */
  scene: ExampleSceneId;
  /** 막히는 곳의 실제 스크린숏. 막히는 곳이 아니면 없다. */
  shot?: ShotProps;
  /** 처음 상태. 테스트에서 특정 모습을 그려 볼 때만 넘긴다. */
  initialState?: ExampleState;
  /** 동작 줄이기의 처음 값. 브라우저에서는 OS 설정을 다시 읽는다. */
  initialReduced?: boolean;
};

/** OS의 동작 줄이기 설정을 듣는다. */
const subscribeReducedMotion = (onChange: () => void) => watchReducedMotion(window.matchMedia, onChange);
/** 지금 동작 줄이기 설정. */
const reducedMotionNow = () => readReducedMotion(window.matchMedia);

/** OS의 동작 줄이기 설정. 바뀌면 따라간다. 서버에서 그릴 때는 `initial`을 쓴다. */
function useReducedMotion(initial: boolean): boolean {
  return useSyncExternalStore(subscribeReducedMotion, reducedMotionNow, () => initial);
}

/** 요소가 처음으로 충분히 보였는지. 한 번 보이면 그대로 둔다. 요소가 그려져 있을 때(`mounted`)만 지켜본다. */
function useSeenOnce(element: RefObject<HTMLElement | null>, mounted: boolean): boolean {
  const [seen, setSeen] = useState(false);
  useEffect(
    function watchFirstSight() {
      const target = element.current;
      if (!mounted || !target || seen) return;
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) setSeen(true);
        },
        { threshold: SEEN_RATIO },
      );
      observer.observe(target);
      return () => observer.disconnect();
    },
    [element, mounted, seen],
  );
  return seen;
}

/** 예시 화면의 커서. */
function Cursor({ cursorRef }: { cursorRef: RefObject<SVGSVGElement | null> }) {
  return (
    <svg ref={cursorRef} className="ex-cursor" viewBox="0 0 20 26" aria-hidden="true">
      <path d="M2 1.5v19.5l5-4.6 3.4 7.6 3.4-1.5-3.3-7.4h6.9z" fill="#111" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

/** 요소 안의 누를 곳 위치. 누를 곳 가운데에서 조금 오른쪽 아래를 가리킨다. */
function targetPoint(view: HTMLElement): Point | null {
  const target = view.querySelector('[data-target]');
  if (!target) return null;
  const viewBox = view.getBoundingClientRect();
  const box = target.getBoundingClientRect();
  return { x: box.left - viewBox.left + box.width * 0.55, y: box.top - viewBox.top + box.height * 0.55 };
}

/** 커서 요소를 한 위치에 놓는다. */
function placeAt(cursor: SVGSVGElement, point: Point) {
  cursor.style.transform = `translate(${point.x}px, ${point.y}px)`;
}

/**
 * 단계 안의 예시 화면 틀. 노란 띠, 빗금 배경 속 장면과 커서, 안내 문구와 [처음부터]를 둔다.
 * 막히는 곳은 실제 스크린숏을 먼저 보이고 [예시]로 바꾸면 장면이 된다.
 */
export function ExampleFrame({ scene, shot, initialState, initialReduced = false }: Props) {
  /** 지금 보일 것. */
  const [view, setView] = useState<FrameView>(shot?.image ? 'shot' : 'example');
  /** 예시 화면 상태. */
  const [state, setState] = useState<ExampleState>(initialState ?? startExample());
  /** 동작 줄이기. */
  const reduced = useReducedMotion(initialReduced);
  /** 장면과 커서를 담는 빗금 칸. */
  const stageRef = useRef<HTMLDivElement>(null);
  /** 커서. */
  const cursorRef = useRef<SVGSVGElement>(null);
  /** 마지막으로 커서를 놓은 곳. */
  const lastPointRef = useRef<Point | null>(null);
  /** 예시 화면이 보이는 위치까지 스크롤했는지. */
  const seen = useSeenOnce(stageRef, view === 'example');

  useLayoutEffect(
    function moveCursorToTarget() {
      const stage = stageRef.current;
      const cursor = cursorRef.current;
      if (view !== 'example' || !stage || !cursor) return;
      const plan = planCursor({
        reduced,
        seen,
        from: lastPointRef.current,
        target: targetPoint(stage),
        view: { width: stage.clientWidth, height: stage.clientHeight },
      });
      if (!plan) {
        cursor.classList.remove('on');
        return;
      }
      // 시작 위치에 전환 없이 놓은 뒤, 다음 프레임에 전환을 켜고 누를 곳으로 옮긴다.
      cursor.classList.remove('moving');
      placeAt(cursor, plan.from);
      cursor.classList.add('on');
      lastPointRef.current = plan.to;
      if (!plan.animate) return;
      const frame = requestAnimationFrame(() => {
        cursor.classList.add('moving');
        placeAt(cursor, plan.to);
      });
      return () => cancelAnimationFrame(frame);
    },
    [view, state.phase, reduced, seen],
  );

  useEffect(
    function keepCursorOnTargetWhenResized() {
      const stage = stageRef.current;
      if (view !== 'example' || !stage) return;
      /** 마지막으로 본 폭. 높이만 바뀌는 것은 모습이 바뀐 것이라 커서 이동이 맡는다. */
      let width = stage.clientWidth;
      // 폭이 바뀌면 누를 곳도 움직이므로 커서를 전환 없이 다시 놓는다.
      const observer = new ResizeObserver(() => {
        if (stage.clientWidth === width) return;
        width = stage.clientWidth;
        const cursor = cursorRef.current;
        const point = targetPoint(stage);
        if (!cursor || !point || !lastPointRef.current) return;
        cursor.classList.remove('moving');
        placeAt(cursor, point);
        lastPointRef.current = point;
      });
      observer.observe(stage);
      return () => observer.disconnect();
    },
    [view],
  );

  /** 처음 모습으로 되돌린다. 커서도 구석에서 다시 출발한다. */
  const restart = () => {
    lastPointRef.current = null;
    setState(startExample());
  };

  /** 실제 스크린숏을 보이는지. */
  const showShot = view === 'shot' && shot?.image;
  /** 장면 밑 안내 문구. 잘못 누르면 경고가 대신한다. */
  const caption = state.warning ?? SCENE_CAPTIONS[scene][state.phase];

  return (
    <figure className="example">
      {showShot ? (
        <>
          <figcaption className="example-band real">실제 화면</figcaption>
          <div className="example-shot">
            <img src={shot.image!.src} width={shot.image!.width} height={shot.image!.height} alt={shot.alt} loading="lazy" />
          </div>
        </>
      ) : (
        <>
          <figcaption className="example-band">{EXAMPLE_BAND}</figcaption>
          <div ref={stageRef} className={seen && !reduced ? 'example-stage seen' : 'example-stage'}>
            <ExampleScene scene={scene} state={state} reduced={reduced} onPress={(button) => setState((current) => pressExample(scene, current, button))} />
            <Cursor cursorRef={cursorRef} />
          </div>
        </>
      )}
      <div className="example-foot">
        <p className={!showShot && state.warning ? 'example-cap warn' : 'example-cap'} role="status">
          {showShot ? shot.caption : caption}
        </p>
        <div className="example-ctl">
          {shot?.image && (
            <div className="seg" role="group" aria-label="보기">
              <button type="button" aria-pressed={view === 'shot'} onClick={() => setView('shot')}>
                실제 화면
              </button>
              <button type="button" aria-pressed={view === 'example'} onClick={() => setView('example')}>
                예시
              </button>
            </div>
          )}
          {!showShot && (
            <button type="button" className="btn sm" onClick={restart}>
              처음부터
            </button>
          )}
        </div>
      </div>
    </figure>
  );
}
