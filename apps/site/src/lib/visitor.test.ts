import { describe, expect, it } from 'vitest';
import { detectVisitor, readVisitor, type VisitorSignals } from './visitor';

/** 브라우저 UA 예시. */
const UA = {
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
  macFirefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:144.0) Gecko/20100101 Firefox/144.0',
  winChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  winFirefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0',
  iPhone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 16; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
};

/** 신호 묶음을 만든다. 적지 않은 값은 데스크톱 브라우저의 기본값이다. */
function signals(overrides: Partial<VisitorSignals> & Pick<VisitorSignals, 'userAgent'>): VisitorSignals {
  return { platform: null, architecture: null, mobile: null, maxTouchPoints: 0, ...overrides };
}

describe('방문 환경 감지', () => {
  it('Chromium이 arm이라고 알려 주는 Mac은 Apple Silicon', () => {
    expect(detectVisitor(signals({ userAgent: UA.macChrome, platform: 'macOS', architecture: 'arm' }))).toBe('mac-arm');
  });

  it('Chromium이 x86이라고 알려 주는 Mac은 Intel Mac', () => {
    expect(detectVisitor(signals({ userAgent: UA.macChrome, platform: 'macOS', architecture: 'x86' }))).toBe('mac-intel');
  });

  it('Safari와 Firefox의 Mac은 칩을 알 수 없다', () => {
    expect(detectVisitor(signals({ userAgent: UA.macSafari }))).toBe('mac-unknown');
    expect(detectVisitor(signals({ userAgent: UA.macFirefox }))).toBe('mac-unknown');
  });

  it('Windows는 x64, Chromium이 arm이라고 알려 주면 Windows ARM', () => {
    expect(detectVisitor(signals({ userAgent: UA.winChrome, platform: 'Windows', architecture: 'x86' }))).toBe('windows');
    expect(detectVisitor(signals({ userAgent: UA.winFirefox }))).toBe('windows');
    expect(detectVisitor(signals({ userAgent: UA.winChrome, platform: 'Windows', architecture: 'arm' }))).toBe('windows-arm');
  });

  it('휴대폰과 태블릿은 휴대폰(데스크톱 UA를 쓰는 iPad 포함)', () => {
    expect(detectVisitor(signals({ userAgent: UA.iPhone, maxTouchPoints: 5 }))).toBe('mobile');
    expect(detectVisitor(signals({ userAgent: UA.android, platform: 'Android', mobile: true, maxTouchPoints: 5 }))).toBe('mobile');
    expect(detectVisitor(signals({ userAgent: UA.macSafari, maxTouchPoints: 5 }))).toBe('mobile');
  });

  it('그 밖의 OS', () => {
    expect(detectVisitor(signals({ userAgent: UA.linux, platform: 'Linux', architecture: 'x86' }))).toBe('other');
  });
});

describe('브라우저에서 신호 읽기', () => {
  it('userAgentData가 있으면 architecture를 묻고, 없으면 UA만 쓴다', async () => {
    /** Chromium의 navigator 흉내. */
    const chromium = {
      userAgent: UA.macChrome,
      maxTouchPoints: 0,
      userAgentData: { platform: 'macOS', mobile: false, getHighEntropyValues: async () => ({ architecture: 'arm' }) },
    };
    /** Safari의 navigator 흉내. */
    const safari = { userAgent: UA.macSafari, maxTouchPoints: 0 };

    expect(await readVisitor(chromium)).toBe('mac-arm');
    expect(await readVisitor(safari)).toBe('mac-unknown');
  });

  it('architecture를 묻다가 실패하면 칩을 모르는 것으로 본다', async () => {
    /** 고엔트로피 값을 거부하는 navigator. */
    const refusing = {
      userAgent: UA.macChrome,
      maxTouchPoints: 0,
      userAgentData: { platform: 'macOS', mobile: false, getHighEntropyValues: () => Promise.reject(new Error('NotAllowedError')) },
    };

    expect(await readVisitor(refusing)).toBe('mac-unknown');
  });
});
