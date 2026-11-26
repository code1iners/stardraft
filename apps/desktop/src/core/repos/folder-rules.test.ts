import { describe, expect, it } from 'vitest';
import { rejectedFolderReason, splitRejectedFolders } from './folder-rules';

describe('받지 않는 저장소 폴더', () => {
  it('네트워크 경로는 받지 않는다', () => {
    expect(rejectedFolderReason('\\\\server\\share\\code')).toBe('network');
    expect(rejectedFolderReason('\\\\?\\UNC\\server\\share')).toBe('network');
  });

  it('WSL 경로는 받지 않는다', () => {
    expect(rejectedFolderReason('\\\\wsl.localhost\\Ubuntu\\home\\me')).toBe('wsl');
    expect(rejectedFolderReason('\\\\wsl$\\Ubuntu\\home\\me')).toBe('wsl');
  });

  it('로컬 절대 경로는 받는다', () => {
    expect(rejectedFolderReason('C:\\Users\\me\\workspace')).toBeNull();
    expect(rejectedFolderReason('\\\\?\\C:\\Users\\me\\workspace')).toBeNull();
    expect(rejectedFolderReason('/Users/me/workspace')).toBeNull();
    expect(rejectedFolderReason('//Users/me/workspace')).toBeNull();
  });

  it('고른 폴더를 받을 것과 받지 않을 것으로 나눈다', () => {
    expect(splitRejectedFolders(['/Users/me/web', '\\\\server\\share', '\\\\wsl$\\Ubuntu\\repo'])).toEqual({
      accepted: ['/Users/me/web'],
      rejected: [
        { path: '\\\\server\\share', reason: 'network' },
        { path: '\\\\wsl$\\Ubuntu\\repo', reason: 'wsl' },
      ],
    });
  });
});
