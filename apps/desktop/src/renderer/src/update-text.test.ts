import { describe, expect, it } from 'vitest';
import { updateStatusText } from './update-text';

/** 지금 시각. 이 PC의 시간대로 2026-10-22 13:00이다. */
const NOW = new Date(2026, 9, 22, 13, 0).getTime();
/** 1분(밀리초). */
const MINUTE_MS = 60_000;

describe('설정 "일반"의 업데이트 상태 문구', () => {
  it('최신 버전이면 마지막으로 확인한 시각을, 확인 중이면 확인 중을 보인다', () => {
    expect(updateStatusText({ kind: 'up-to-date', checkedAt: new Date(2026, 9, 22, 10, 20).getTime() }, NOW)).toBe(
      '최신 버전입니다 · 마지막 확인 오전 10:20',
    );
    expect(updateStatusText({ kind: 'checking' }, NOW)).toBe('확인 중…');
    expect(updateStatusText({ kind: 'idle' }, NOW)).toBe('아직 확인하지 않았습니다');
  });

  it('확인이나 다운로드가 실패했으면 실패한 지 얼마나 됐는지 보인다', () => {
    expect(updateStatusText({ kind: 'check-failed', failedAt: NOW - 30_000 }, NOW)).toBe('마지막 확인 실패 · 방금');
    expect(updateStatusText({ kind: 'check-failed', failedAt: NOW - 59 * MINUTE_MS }, NOW)).toBe('마지막 확인 실패 · 59분 전');
    expect(updateStatusText({ kind: 'check-failed', failedAt: NOW - 3 * 60 * MINUTE_MS - 30 * MINUTE_MS }, NOW)).toBe('마지막 확인 실패 · 3시간 전');
    expect(updateStatusText({ kind: 'check-failed', failedAt: NOW - 2 * 24 * 60 * MINUTE_MS }, NOW)).toBe('마지막 확인 실패 · 2일 전');
  });

  it('받는 중이면 버전과 받은 비율을 보인다', () => {
    expect(updateStatusText({ kind: 'downloading', version: '0.2.0', percent: 45 }, NOW)).toBe('0.2.0 받는 중… 45%');
  });

  it('설치 준비됨이면 새 버전을 알리고, 버전 끝자리를 읽은 소리에 맞춰 조사를 고른다', () => {
    expect(updateStatusText({ kind: 'ready', version: '0.2.0' }, NOW)).toBe('새 버전 0.2.0이 준비됐습니다');
    expect(updateStatusText({ kind: 'ready', version: '0.2.3' }, NOW)).toBe('새 버전 0.2.3이 준비됐습니다');
    expect(updateStatusText({ kind: 'ready', version: '0.2.2' }, NOW)).toBe('새 버전 0.2.2가 준비됐습니다');
    expect(updateStatusText({ kind: 'ready', version: '0.2.9' }, NOW)).toBe('새 버전 0.2.9가 준비됐습니다');
  });

  it('서명 검증에 실패했으면 설치하지 않았다고만 알리고 사이트에서 받으라고 권하지 않는다', () => {
    expect(updateStatusText({ kind: 'signature-failed', version: '0.2.0' }, NOW)).toBe(
      '업데이트 파일의 서명이 맞지 않아 설치하지 않았습니다. 지금 버전을 계속 씁니다.',
    );
  });

  it('앱이 스스로 바꿀 수 없는 위치면 새 버전과 까닭을 보인다', () => {
    expect(updateStatusText({ kind: 'location-blocked', version: '0.2.0', reason: 'read-only' }, NOW)).toBe(
      '새 버전 0.2.0 · 응용 프로그램 폴더로 옮긴 뒤 다시 여세요',
    );
    expect(updateStatusText({ kind: 'location-blocked', version: '0.2.0', reason: 'no-permission' }, NOW)).toBe(
      '새 버전 0.2.0 · 이 계정은 Stardraft를 바꿀 권한이 없습니다',
    );
  });
});
