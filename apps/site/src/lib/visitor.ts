// 방문한 PC가 어떤 설치 파일을 받아야 하는지 브라우저 정보로 가늠한다. 칩은 Chromium의 `userAgentData`만 알려 준다.

/**
 * 첫 화면을 고르는 방문 환경.
 * - `mac-arm`: Apple Silicon Mac(Chromium이 알려 줌)
 * - `mac-unknown`: 칩을 알 수 없는 Mac(Safari, Firefox)
 * - `mac-intel`: Intel Mac(Chromium이 알려 줌). 지원하지 않는다.
 * - `windows`: Windows(x64로 본다)
 * - `windows-arm`: ARM Windows(Chromium이 알려 줌). x64 에뮬레이션으로 돈다.
 * - `mobile`: 휴대폰과 태블릿
 * - `other`: 그 밖의 OS
 */
export type Visitor = 'mac-arm' | 'mac-unknown' | 'mac-intel' | 'windows' | 'windows-arm' | 'mobile' | 'other';

/** 감지에 쓰는 브라우저 정보. */
export type VisitorSignals = {
  /** `navigator.userAgent`. */
  userAgent: string;
  /** `navigator.userAgentData.platform`. Chromium이 아니면 null. */
  platform: string | null;
  /** `getHighEntropyValues(['architecture'])`의 `architecture`(`arm`, `x86` 등). 모르면 null. */
  architecture: string | null;
  /** `navigator.userAgentData.mobile`. Chromium이 아니면 null. */
  mobile: boolean | null;
  /** `navigator.maxTouchPoints`. 데스크톱 UA를 쓰는 iPad를 가려낸다. */
  maxTouchPoints: number;
};

/** 브라우저 정보로 방문 환경을 고른다. */
export function detectVisitor(signals: VisitorSignals): Visitor {
  const { userAgent, platform, architecture, mobile, maxTouchPoints } = signals;

  // iPadOS Safari는 Mac UA를 쓰므로 터치 지원으로 가려낸다.
  if (mobile || /iPhone|iPad|iPod|Android|Mobile/i.test(userAgent) || (maxTouchPoints > 1 && /Macintosh/.test(userAgent))) return 'mobile';

  /** OS를 가리키는 문자열. Chromium은 UA를 고정해 두므로 platform을 먼저 본다. */
  const os = platform ?? userAgent;
  if (/mac/i.test(os)) {
    if (architecture === 'arm') return 'mac-arm';
    if (architecture === 'x86') return 'mac-intel';
    return 'mac-unknown';
  }
  if (/win/i.test(os)) return architecture === 'arm' ? 'windows-arm' : 'windows';
  return 'other';
}

/** 감지에 쓰는 `navigator`의 일부. */
export type NavigatorLike = {
  userAgent: string;
  maxTouchPoints: number;
  userAgentData?: {
    platform: string;
    mobile: boolean;
    getHighEntropyValues(hints: string[]): Promise<{ architecture?: string }>;
  };
};

/** 브라우저의 `navigator`에서 방문 환경을 읽는다. */
export async function readVisitor(navigator: NavigatorLike): Promise<Visitor> {
  /** Chromium의 UA Client Hints. */
  const data = navigator.userAgentData;
  /** 칩. 묻지 못하면 모르는 것으로 둔다. */
  const architecture = await data?.getHighEntropyValues(['architecture']).then(
    (values) => values.architecture ?? null,
    () => null,
  );
  return detectVisitor({
    userAgent: navigator.userAgent,
    platform: data?.platform ?? null,
    architecture: architecture ?? null,
    mobile: data?.mobile ?? null,
    maxTouchPoints: navigator.maxTouchPoints,
  });
}
