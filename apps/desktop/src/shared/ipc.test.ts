import { describe, expect, it } from 'vitest';
import {
  AGENT_MODEL_MAX_LENGTH,
  FLOW_API_KEY_MAX_LENGTH,
  FLOW_PROJECT_ID_MAX_LENGTH,
  parseAppCommand,
  WORK_FOLDER_PATH_MAX_LENGTH,
} from './ipc';

describe('렌더러가 보낸 명령 검사', () => {
  it('설정 열기 명령을 칸과 함께 받는다', () => {
    expect(parseAppCommand({ type: 'open-settings', section: 'agent' })).toEqual({
      type: 'open-settings',
      section: 'agent',
    });
  });

  it('칸이 없는 설정 열기 명령을 받는다', () => {
    expect(parseAppCommand({ type: 'open-settings' })).toEqual({ type: 'open-settings' });
  });

  it('데이터 폴더와 로그 폴더 열기 명령을 받는다', () => {
    expect(parseAppCommand({ type: 'open-folder', folder: 'data' })).toEqual({ type: 'open-folder', folder: 'data' });
    expect(parseAppCommand({ type: 'open-folder', folder: 'logs' })).toEqual({ type: 'open-folder', folder: 'logs' });
  });

  it('정해진 폴더가 아니면 폴더 열기 명령을 거부한다', () => {
    expect(parseAppCommand({ type: 'open-folder', folder: '/etc' })).toBeNull();
    expect(parseAppCommand({ type: 'open-folder' })).toBeNull();
  });

  it('키 확인 명령은 붙여 넣은 키를 그대로 받는다', () => {
    expect(parseAppCommand({ type: 'check-flow-key', apiKey: ' fake-key-1\n' })).toEqual({
      type: 'check-flow-key',
      apiKey: ' fake-key-1\n',
    });
  });

  it('키가 비었거나 문자열이 아니거나 너무 길면 키 확인 명령을 거부한다', () => {
    expect(parseAppCommand({ type: 'check-flow-key', apiKey: '' })).toBeNull();
    expect(parseAppCommand({ type: 'check-flow-key', apiKey: ' \n ' })).toBeNull();
    expect(parseAppCommand({ type: 'check-flow-key', apiKey: 42 })).toBeNull();
    expect(parseAppCommand({ type: 'check-flow-key' })).toBeNull();
    expect(parseAppCommand({ type: 'check-flow-key', apiKey: 'k'.repeat(FLOW_API_KEY_MAX_LENGTH + 1) })).toBeNull();
  });

  it('다른 계정으로 바꾸기 확인과 키 확인 그만두기 명령을 받는다', () => {
    expect(parseAppCommand({ type: 'confirm-flow-account-switch' })).toEqual({ type: 'confirm-flow-account-switch' });
    expect(parseAppCommand({ type: 'cancel-flow-key-check' })).toEqual({ type: 'cancel-flow-key-check' });
  });

  it('에이전트 확인 명령을 받고, 렌더러가 실은 경로나 명령은 버린다', () => {
    expect(parseAppCommand({ type: 'check-agent' })).toEqual({ type: 'check-agent' });
    expect(parseAppCommand({ type: 'rediscover-agent' })).toEqual({ type: 'rediscover-agent' });
    expect(parseAppCommand({ type: 'pick-agent-cli', path: '/tmp/evil' })).toEqual({ type: 'pick-agent-cli' });
    expect(parseAppCommand({ type: 'copy-agent-fix-command', text: 'rm -rf ~' })).toEqual({ type: 'copy-agent-fix-command' });
  });

  it('기본 에이전트 고르기 명령은 앱이 아는 에이전트만 받는다', () => {
    expect(parseAppCommand({ type: 'set-default-agent', agent: 'codex' })).toEqual({ type: 'set-default-agent', agent: 'codex' });
    expect(parseAppCommand({ type: 'set-default-agent', agent: 'gemini' })).toBeNull();
    expect(parseAppCommand({ type: 'set-default-agent' })).toBeNull();
  });

  it('모델 고르기 명령은 모델 이름이나 기본 모델(null)을 받는다', () => {
    expect(parseAppCommand({ type: 'set-agent-model', agent: 'claude-code', model: 'opus' })).toEqual({
      type: 'set-agent-model',
      agent: 'claude-code',
      model: 'opus',
    });
    expect(parseAppCommand({ type: 'set-agent-model', agent: 'claude-code', model: null })).toEqual({
      type: 'set-agent-model',
      agent: 'claude-code',
      model: null,
    });
  });

  it('모델 이름이 비었거나 문자열이 아니거나 너무 길면 모델 고르기 명령을 거부한다', () => {
    expect(parseAppCommand({ type: 'set-agent-model', agent: 'claude-code', model: '' })).toBeNull();
    expect(parseAppCommand({ type: 'set-agent-model', agent: 'claude-code', model: 3 })).toBeNull();
    expect(parseAppCommand({ type: 'set-agent-model', agent: 'claude-code' })).toBeNull();
    expect(parseAppCommand({ type: 'set-agent-model', agent: 'unknown', model: 'opus' })).toBeNull();
    expect(parseAppCommand({ type: 'set-agent-model', agent: 'claude-code', model: 'm'.repeat(AGENT_MODEL_MAX_LENGTH + 1) })).toBeNull();
  });

  it('작업 폴더 고르기와 다시 훑기 명령을 받고, 렌더러가 실은 경로는 버린다', () => {
    expect(parseAppCommand({ type: 'pick-work-folders', paths: ['/tmp/evil'] })).toEqual({ type: 'pick-work-folders' });
    expect(parseAppCommand({ type: 'refresh-work-folders' })).toEqual({ type: 'refresh-work-folders' });
  });

  it('제안 폴더 추가와 작업 폴더 지우기 명령은 경로 문자열을 받는다', () => {
    expect(parseAppCommand({ type: 'add-suggested-work-folder', path: '/Users/me/workspace' })).toEqual({
      type: 'add-suggested-work-folder',
      path: '/Users/me/workspace',
    });
    expect(parseAppCommand({ type: 'remove-work-folder', path: 'C:\\Users\\me\\code' })).toEqual({
      type: 'remove-work-folder',
      path: 'C:\\Users\\me\\code',
    });
  });

  it('경로가 비었거나 문자열이 아니거나 너무 길면 작업 폴더 명령을 거부한다', () => {
    expect(parseAppCommand({ type: 'add-suggested-work-folder', path: '' })).toBeNull();
    expect(parseAppCommand({ type: 'remove-work-folder', path: 1 })).toBeNull();
    expect(parseAppCommand({ type: 'remove-work-folder' })).toBeNull();
    expect(parseAppCommand({ type: 'remove-work-folder', path: '/'.repeat(WORK_FOLDER_PATH_MAX_LENGTH + 1) })).toBeNull();
  });

  it('저장소 매핑 명령은 Flow 프로젝트 ID를 받고, 폴더 고르기에서 렌더러가 실은 경로는 버린다', () => {
    expect(parseAppCommand({ type: 'refresh-repo-mappings' })).toEqual({ type: 'refresh-repo-mappings' });
    expect(parseAppCommand({ type: 'pick-mapping-repos', projectId: '101', paths: ['/tmp/evil'] })).toEqual({
      type: 'pick-mapping-repos',
      projectId: '101',
    });
    expect(parseAppCommand({ type: 'remove-repo-mapping', projectId: '101' })).toEqual({ type: 'remove-repo-mapping', projectId: '101' });
    expect(parseAppCommand({ type: 'remove-mapping-repo', projectId: '101', path: '/Users/me/api' })).toEqual({
      type: 'remove-mapping-repo',
      projectId: '101',
      path: '/Users/me/api',
    });
  });

  it('Flow 프로젝트 ID나 경로가 비었거나 문자열이 아니거나 너무 길면 저장소 매핑 명령을 거부한다', () => {
    expect(parseAppCommand({ type: 'pick-mapping-repos', projectId: '' })).toBeNull();
    expect(parseAppCommand({ type: 'pick-mapping-repos', projectId: 101 })).toBeNull();
    expect(parseAppCommand({ type: 'remove-repo-mapping', projectId: '1'.repeat(FLOW_PROJECT_ID_MAX_LENGTH + 1) })).toBeNull();
    expect(parseAppCommand({ type: 'remove-mapping-repo', projectId: '101' })).toBeNull();
    expect(parseAppCommand({ type: 'remove-mapping-repo', projectId: '101', path: '' })).toBeNull();
  });

  it('감지 시작 명령을 받는다', () => {
    expect(parseAppCommand({ type: 'start-detection' })).toEqual({ type: 'start-detection' });
  });

  it('로그인 시 자동 시작 명령은 참·거짓만 받는다', () => {
    expect(parseAppCommand({ type: 'set-launch-at-login', enabled: false })).toEqual({ type: 'set-launch-at-login', enabled: false });
    expect(parseAppCommand({ type: 'set-launch-at-login', enabled: 'yes' })).toBeNull();
    expect(parseAppCommand({ type: 'set-launch-at-login' })).toBeNull();
  });

  it('묶음 무시·되돌리기·Flow에서 열기 명령은 묶음 ID(양의 정수)를 받는다', () => {
    for (const type of ['ignore-bundle', 'restore-bundle', 'open-bundle-in-flow'] as const) {
      expect(parseAppCommand({ type, bundleId: 3 })).toEqual({ type, bundleId: 3 });
      expect(parseAppCommand({ type, bundleId: 0 })).toBeNull();
      expect(parseAppCommand({ type, bundleId: 1.5 })).toBeNull();
      expect(parseAppCommand({ type, bundleId: '3' })).toBeNull();
      expect(parseAppCommand({ type })).toBeNull();
    }
  });

  it('펼쳐 보기·접어 보기 명령은 보고 있던 묶음 ID나 null을 받는다', () => {
    expect(parseAppCommand({ type: 'expand-review', bundleId: 3 })).toEqual({ type: 'expand-review', bundleId: 3 });
    expect(parseAppCommand({ type: 'collapse-review', bundleId: null })).toEqual({ type: 'collapse-review', bundleId: null });
    expect(parseAppCommand({ type: 'expand-review' })).toBeNull();
    expect(parseAppCommand({ type: 'collapse-review', bundleId: -1 })).toBeNull();
  });

  it('영역 펼침 명령은 창과 영역 이름, 참·거짓을 받는다', () => {
    expect(parseAppCommand({ type: 'set-review-section', window: 'compact', section: 'repository', open: true })).toEqual({
      type: 'set-review-section',
      window: 'compact',
      section: 'repository',
      open: true,
    });
    expect(parseAppCommand({ type: 'set-review-section', window: 'settings', section: 'repository', open: true })).toBeNull();
    expect(parseAppCommand({ type: 'set-review-section', window: 'expanded', section: 'draft', open: true })).toBeNull();
    expect(parseAppCommand({ type: 'set-review-section', window: 'expanded', section: 'original', open: 'yes' })).toBeNull();
  });

  it('모르는 칸, 모르는 명령, 객체가 아닌 값은 거부한다', () => {
    expect(parseAppCommand({ type: 'open-settings', section: '../../etc' })).toBeNull();
    expect(parseAppCommand({ type: 'run-shell', command: 'rm -rf /' })).toBeNull();
    expect(parseAppCommand('open-settings')).toBeNull();
    expect(parseAppCommand(null)).toBeNull();
  });
});
