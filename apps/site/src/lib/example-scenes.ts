// 설치 안내의 예시 화면이 누를 곳을 누를 때마다 어느 모습으로 넘어가는지 정한다. 그리는 일은 컴포넌트가 맡는다.

/** 예시 화면 하나의 한 모습. */
type ExamplePhase = {
  /** 이 모습에서 누를 곳. null이면 더 누를 곳이 없는 마지막 모습이다. */
  target: string | null;
  /** 누를 곳을 누르면 넘어갈 모습. */
  next?: string;
  /** 잘못 누를 수 있는 버튼과 눌렀을 때의 경고. 누르면 모습은 그대로다. */
  wrong?: Record<string, string>;
};

/** 휴지통으로 이동을 눌렀을 때의 경고. */
const TRASH_WARNING = '실제 창에서는 누르지 마세요. 앱이 휴지통으로 갑니다.';
/** 한 번 더 확인하는 창에서 완료를 눌렀을 때의 경고. */
const NOT_OPENED_WARNING = '완료를 누르면 열리지 않습니다. 시스템 설정에서 그래도 열기를 다시 누르세요.';
/** Windows의 PC 보호 창에서 실행 안 함을 눌렀을 때의 경고. */
const DONT_RUN_WARNING = '실행 안 함을 누르면 설치가 멈춥니다. 설치 파일을 다시 열면 이 창이 다시 뜹니다.';

/** 예시 화면마다 모습. 첫 모습은 언제나 `start`다. */
export const EXAMPLE_SCENES = {
  /** macOS ①: DMG 창에서 앱을 Applications 폴더로 옮긴다. */
  'mac-dmg': {
    start: { target: 'drag', next: 'moved' },
    moved: { target: null },
  },
  /** macOS ②: "열지 않음" 창에서 완료를 누른다. */
  'mac-blocked': {
    start: { target: 'done', next: 'closed', wrong: { trash: TRASH_WARNING } },
    closed: { target: null },
  },
  /** macOS ③: 시스템 설정의 보안 항목에서 그래도 열기를 누른다. */
  'mac-settings': {
    start: { target: 'open', next: 'clicked' },
    clicked: { target: null },
  },
  /** macOS ④: 한 번 더 그래도 열기를 누르고 암호를 넣는다. */
  'mac-confirm': {
    start: { target: 'open', next: 'password', wrong: { done: NOT_OPENED_WARNING } },
    password: { target: 'ok', next: 'opened' },
    opened: { target: null },
  },
  /** macOS ⑤: 알림을 허용하면 메뉴 막대의 아이콘이 보인다. */
  'mac-done': {
    start: { target: 'allow', next: 'allowed' },
    allowed: { target: null },
  },
  /** Windows ①: Windows 보안에서 스마트 앱 컨트롤 설정까지 들어가 상태를 본다. */
  'win-sac': {
    start: { target: 'app-browser', next: 'app-browser' },
    'app-browser': { target: 'sac-settings', next: 'status' },
    status: { target: null },
  },
  /** Windows ②: PC 보호 창에서 추가 정보 → 실행을 누른다. */
  'win-smartscreen': {
    start: { target: 'more', next: 'more', wrong: { 'dont-run': DONT_RUN_WARNING } },
    more: { target: 'run', next: 'installing', wrong: { 'dont-run': DONT_RUN_WARNING } },
    installing: { target: null },
  },
  /** Windows ③: 묻는 것 없이 설치된다. 누를 곳이 없다. */
  'win-install': {
    start: { target: null },
  },
  /** Windows ④: 숨겨진 아이콘(^)을 펼쳐 트레이 아이콘을 찾는다. */
  'win-done': {
    start: { target: 'chevron', next: 'open' },
    open: { target: null },
  },
} satisfies Record<string, { start: ExamplePhase } & Record<string, ExamplePhase>>;

/** 예시 화면 이름. */
export type ExampleSceneId = keyof typeof EXAMPLE_SCENES;

/** 예시 화면 하나의 지금 상태. */
export type ExampleState = {
  /** 지금 모습. */
  phase: string;
  /** 잘못 누른 버튼의 경고. 없으면 null. */
  warning: string | null;
};

/** 예시 화면의 모습 규칙. 모르는 모습은 누를 곳 없는 모습으로 본다. */
function phaseOf(scene: ExampleSceneId, phase: string): ExamplePhase {
  return (EXAMPLE_SCENES[scene] as Record<string, ExamplePhase>)[phase] ?? { target: null };
}

/** 예시 화면의 처음 상태. "처음부터"도 이 상태로 되돌린다. */
export function startExample(): ExampleState {
  return { phase: 'start', warning: null };
}

/** 지금 모습에서 누를 곳. 커서와 강조 테두리가 가리킨다. 마지막 모습이면 null. */
export function exampleTarget(scene: ExampleSceneId, state: ExampleState): string | null {
  return phaseOf(scene, state.phase).target;
}

/** 예시 화면의 버튼을 누른다. 누를 곳이면 다음 모습으로, 잘못된 버튼이면 경고를 띄우고, 그 밖에는 그대로 둔다. */
export function pressExample(scene: ExampleSceneId, state: ExampleState, button: string): ExampleState {
  const rule = phaseOf(scene, state.phase);
  if (rule.target === button && rule.next) return { phase: rule.next, warning: null };
  const warning = rule.wrong?.[button];
  if (warning) return { phase: state.phase, warning };
  return state;
}
