import { describe, expect, it } from 'vitest';
import { updateFieldView } from './update-text';

/** 지금 시각. 이 PC의 시간대로 2026-10-22 13:00이다. */
const NOW = new Date(2026, 9, 22, 13, 0).getTime();
/** 1분(밀리초). */
const MINUTE_MS = 60_000;

describe('설정 "일반"의 업데이트 칸', () => {
  it('아직 확인하지 않았으면 그렇다고 알리고 [지금 확인]을 둔다', () => {
    expect(updateFieldView({ kind: 'idle' }, NOW)).toEqual({
      text: '아직 확인하지 않았습니다',
      danger: false,
      progress: null,
      button: 'check-now',
      showsElapsed: false,
    });
  });

  it('최신 버전이면 마지막으로 확인한 시각과 [지금 확인]을, 확인 중이면 확인 중만 보인다', () => {
    expect(updateFieldView({ kind: 'up-to-date', checkedAt: new Date(2026, 9, 22, 10, 20).getTime() }, NOW)).toEqual({
      text: '최신 버전입니다 · 마지막 확인 오전 10:20',
      danger: false,
      progress: null,
      button: 'check-now',
      showsElapsed: false,
    });
    expect(updateFieldView({ kind: 'checking' }, NOW)).toEqual({ text: '확인 중…', danger: false, progress: null, button: null, showsElapsed: false });
  });

  it('확인이나 다운로드가 실패했으면 실패한 지 얼마나 됐는지와 [지금 확인]을 보이고, 시간이 흐르면 새로 그린다', () => {
    expect(updateFieldView({ kind: 'check-failed', failedAt: NOW - 3 * 60 * MINUTE_MS - 30 * MINUTE_MS }, NOW)).toEqual({
      text: '마지막 확인 실패 · 3시간 전',
      danger: false,
      progress: null,
      button: 'check-now',
      showsElapsed: true,
    });
    expect(updateFieldView({ kind: 'check-failed', failedAt: NOW - 30_000 }, NOW).text).toBe('마지막 확인 실패 · 방금');
    expect(updateFieldView({ kind: 'check-failed', failedAt: NOW - 59 * MINUTE_MS }, NOW).text).toBe('마지막 확인 실패 · 59분 전');
    expect(updateFieldView({ kind: 'check-failed', failedAt: NOW - 2 * 24 * 60 * MINUTE_MS }, NOW).text).toBe('마지막 확인 실패 · 2일 전');
  });

  it('받는 중이면 버전과 받은 비율을 문구와 진행 막대로 보이고 누를 것은 없다', () => {
    expect(updateFieldView({ kind: 'downloading', version: '0.2.0', percent: 45 }, NOW)).toEqual({
      text: '0.2.0 받는 중… 45%',
      danger: false,
      progress: 45,
      button: null,
      showsElapsed: false,
    });
  });

  it('설치 준비됨이면 새 버전을 알리고, 버전 끝자리를 읽은 소리에 맞춰 조사를 고른다', () => {
    expect(updateFieldView({ kind: 'ready', version: '0.2.0' }, NOW)).toEqual({
      text: '새 버전 0.2.0이 준비됐습니다',
      danger: false,
      progress: null,
      button: null,
      showsElapsed: false,
    });
    expect(updateFieldView({ kind: 'ready', version: '0.2.3' }, NOW).text).toBe('새 버전 0.2.3이 준비됐습니다');
    expect(updateFieldView({ kind: 'ready', version: '0.2.2' }, NOW).text).toBe('새 버전 0.2.2가 준비됐습니다');
    expect(updateFieldView({ kind: 'ready', version: '0.2.9' }, NOW).text).toBe('새 버전 0.2.9가 준비됐습니다');
  });

  it('서명 검증에 실패했으면 설치하지 않았다고만 위험 색으로 알리고 [다시 시도]를 둔다. 사이트에서 받으라고 권하지 않는다', () => {
    expect(updateFieldView({ kind: 'signature-failed', version: '0.2.0' }, NOW)).toEqual({
      text: '업데이트 파일의 서명이 맞지 않아 설치하지 않았습니다. 지금 버전을 계속 씁니다.',
      danger: true,
      progress: null,
      button: 'retry',
      showsElapsed: false,
    });
  });

  it('앱이 스스로 바꿀 수 없는 위치면 새 버전과 까닭, [사이트에서 받기]를 보인다', () => {
    expect(updateFieldView({ kind: 'location-blocked', version: '0.2.0', reason: 'read-only' }, NOW)).toEqual({
      text: '새 버전 0.2.0 · 응용 프로그램 폴더로 옮긴 뒤 다시 여세요',
      danger: false,
      progress: null,
      button: 'open-site',
      showsElapsed: false,
    });
    expect(updateFieldView({ kind: 'location-blocked', version: '0.2.0', reason: 'no-permission' }, NOW).text).toBe(
      '새 버전 0.2.0 · 이 계정은 Stardraft를 바꿀 권한이 없습니다',
    );
  });
});
