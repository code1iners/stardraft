import { describe, expect, it } from 'vitest';
import type { UpdateStateSnapshot } from '../../shared/ipc';
import { updateBannerView, updateFieldView } from './update-text';

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
      buttons: ['check-now'],
      showsElapsed: false,
    });
  });

  it('최신 버전이면 마지막으로 확인한 시각과 [지금 확인]을, 확인 중이면 확인 중만 보인다', () => {
    expect(updateFieldView({ kind: 'up-to-date', checkedAt: new Date(2026, 9, 22, 10, 20).getTime() }, NOW)).toEqual({
      text: '최신 버전입니다 · 마지막 확인 오전 10:20',
      danger: false,
      progress: null,
      buttons: ['check-now'],
      showsElapsed: false,
    });
    expect(updateFieldView({ kind: 'checking' }, NOW)).toEqual({ text: '확인 중…', danger: false, progress: null, buttons: [], showsElapsed: false });
  });

  it('확인이나 다운로드가 실패했으면 실패한 지 얼마나 됐는지와 [지금 확인]을 보이고, 시간이 흐르면 새로 그린다', () => {
    expect(updateFieldView({ kind: 'check-failed', failedAt: NOW - 3 * 60 * MINUTE_MS - 30 * MINUTE_MS }, NOW)).toEqual({
      text: '마지막 확인 실패 · 3시간 전',
      danger: false,
      progress: null,
      buttons: ['check-now'],
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
      buttons: [],
      showsElapsed: false,
    });
  });

  it('설치 준비됨이면 새 버전과 [다시 시작] [변경 내역]을 보이고, 버전 끝자리를 읽은 소리에 맞춰 조사를 고른다', () => {
    expect(updateFieldView({ kind: 'ready', version: '0.2.0' }, NOW)).toEqual({
      text: '새 버전 0.2.0이 준비됐습니다',
      danger: false,
      progress: null,
      buttons: ['restart', 'changelog'],
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
      buttons: ['retry'],
      showsElapsed: false,
    });
  });

  it('앱이 스스로 바꿀 수 없는 위치면 새 버전과 까닭, [사이트에서 받기]를 보인다', () => {
    expect(updateFieldView({ kind: 'location-blocked', version: '0.2.0', reason: 'read-only' }, NOW)).toEqual({
      text: '새 버전 0.2.0 · 응용 프로그램 폴더로 옮긴 뒤 다시 여세요',
      danger: false,
      progress: null,
      buttons: ['open-site'],
      showsElapsed: false,
    });
    expect(updateFieldView({ kind: 'location-blocked', version: '0.2.0', reason: 'no-permission' }, NOW).text).toBe(
      '새 버전 0.2.0 · 이 계정은 Stardraft를 바꿀 권한이 없습니다',
    );
  });

  it('다시 시작 대기면 기다리는 일에 맞춘 문구만 보인다', () => {
    expect(updateFieldView({ kind: 'restart-pending', version: '0.2.0', waitingFor: { drafting: true, posting: false } }, NOW)).toEqual({
      text: '초안 생성이 끝나면 다시 시작합니다',
      danger: false,
      progress: null,
      buttons: [],
      showsElapsed: false,
    });
    expect(updateFieldView({ kind: 'restart-pending', version: '0.2.0', waitingFor: { drafting: false, posting: true } }, NOW).text).toBe(
      '게시가 끝나면 다시 시작합니다',
    );
  });

  it('설치 실패면 위험 색으로 알리고 [다시 시도] [사이트에서 받기]를, 앱 안에서 거부됐으면 [사이트에서 받기]만 둔다', () => {
    expect(updateFieldView({ kind: 'install-failed', version: '0.2.0', reason: 'not-applied' }, NOW)).toEqual({
      text: '0.2.0으로 업데이트하지 못했습니다',
      danger: true,
      progress: null,
      buttons: ['retry-install', 'open-site'],
      showsElapsed: false,
    });
    expect(updateFieldView({ kind: 'install-failed', version: '0.2.1', reason: 'not-applied' }, NOW).text).toBe('0.2.1로 업데이트하지 못했습니다');
    expect(updateFieldView({ kind: 'install-failed', version: '0.2.0', reason: 'rejected' }, NOW)).toEqual({
      text: '이 버전은 앱 안에서 업데이트할 수 없습니다. 사이트에서 받아 설치하세요.',
      danger: true,
      progress: null,
      buttons: ['open-site'],
      showsElapsed: false,
    });
  });
});

/** 띠를 그릴 업데이트 화면 상태. 주지 않은 것은 업데이트 직후도 아니고 닫은 띠도 없다. */
function stateOf(status: UpdateStateSnapshot['status'], overrides: Partial<UpdateStateSnapshot> = {}): UpdateStateSnapshot {
  return { status, justUpdated: null, restartConfirm: null, dismissedBanners: [], ...overrides };
}

describe('작은 창의 업데이트 띠', () => {
  it('최신·확인 중·받는 중·확인 실패에는 띠가 없다', () => {
    for (const status of [
      { kind: 'idle' },
      { kind: 'checking' },
      { kind: 'up-to-date', checkedAt: NOW },
      { kind: 'check-failed', failedAt: NOW },
      { kind: 'downloading', version: '0.2.0', percent: 10 },
    ] as const) {
      expect(updateBannerView(stateOf(status))).toBeNull();
    }
  });

  it('설치 준비됨이면 "새 버전 0.2.0이 준비됐습니다"와 [다시 시작] [변경 내역]을 둔다', () => {
    expect(updateBannerView(stateOf({ kind: 'ready', version: '0.2.0' }))).toEqual({
      id: 'ready:0.2.0',
      text: '새 버전 0.2.0이 준비됐습니다',
      danger: false,
      buttons: ['restart', 'changelog'],
    });
  });

  it('다시 시작 대기면 문구와 [지금 다시 시작] [취소]를 둔다', () => {
    expect(updateBannerView(stateOf({ kind: 'restart-pending', version: '0.2.0', waitingFor: { drafting: true, posting: false } }))).toEqual({
      id: 'restart-pending:0.2.0',
      text: '초안 생성이 끝나면 다시 시작합니다',
      danger: false,
      buttons: ['restart-now', 'cancel-restart'],
    });
  });

  it('스스로 바꿀 수 없는 위치면 까닭과 [사이트에서 받기]를 둔다', () => {
    expect(updateBannerView(stateOf({ kind: 'location-blocked', version: '0.2.0', reason: 'no-permission' }))).toEqual({
      id: 'location-blocked:0.2.0',
      text: '새 버전 0.2.0 · 이 계정은 Stardraft를 바꿀 권한이 없습니다',
      danger: false,
      buttons: ['open-site'],
    });
  });

  it('서명 검증 실패면 서명 실패 문구와 [닫기]를 두고, 닫으면 그 버전의 띠는 다시 보이지 않는다', () => {
    /** 서명 검증 실패. */
    const failed = { kind: 'signature-failed', version: '0.2.0' } as const;
    expect(updateBannerView(stateOf(failed))).toEqual({
      id: 'signature-failed:0.2.0',
      text: '업데이트 파일의 서명이 맞지 않아 설치하지 않았습니다. 지금 버전을 계속 씁니다.',
      danger: true,
      buttons: ['dismiss'],
    });
    expect(updateBannerView(stateOf(failed, { dismissedBanners: ['signature-failed:0.2.0'] }))).toBeNull();
    expect(updateBannerView(stateOf({ kind: 'signature-failed', version: '0.3.0' }, { dismissedBanners: ['signature-failed:0.2.0'] }))).not.toBeNull();
  });

  it('설치 실패면 설정과 같은 문구와 버튼을 둔다', () => {
    expect(updateBannerView(stateOf({ kind: 'install-failed', version: '0.2.0', reason: 'not-applied' }))).toEqual({
      id: 'install-failed:0.2.0',
      text: '0.2.0으로 업데이트하지 못했습니다',
      danger: true,
      buttons: ['retry-install', 'open-site'],
    });
    expect(updateBannerView(stateOf({ kind: 'install-failed', version: '0.2.0', reason: 'rejected' }))?.buttons).toEqual(['open-site']);
  });

  it('업데이트 직후 첫 실행이면 띠를 둘 상태가 없을 때 "0.2.0으로 업데이트했습니다"와 [변경 내역] [닫기]를 두고, 닫으면 보이지 않는다', () => {
    expect(updateBannerView(stateOf({ kind: 'up-to-date', checkedAt: NOW }, { justUpdated: '0.2.0' }))).toEqual({
      id: 'updated:0.2.0',
      text: '0.2.0으로 업데이트했습니다',
      danger: false,
      buttons: ['changelog', 'dismiss'],
    });
    expect(updateBannerView(stateOf({ kind: 'ready', version: '0.3.0' }, { justUpdated: '0.2.0' }))?.id).toBe('ready:0.3.0');
    expect(updateBannerView(stateOf({ kind: 'idle' }, { justUpdated: '0.2.0', dismissedBanners: ['updated:0.2.0'] }))).toBeNull();
  });

  it('서명 실패 띠를 닫았으면 그 아래의 업데이트 직후 띠를 보인다', () => {
    expect(
      updateBannerView(stateOf({ kind: 'signature-failed', version: '0.3.0' }, { justUpdated: '0.2.0', dismissedBanners: ['signature-failed:0.3.0'] }))?.id,
    ).toBe('updated:0.2.0');
  });
});
