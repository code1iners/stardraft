import { describe, expect, it } from 'vitest';
import type { InstallerOs } from './releases';
import { announceInstallOs, onInstallOsChosen } from './install-os';

describe('받을 OS 알림', () => {
  it('다운로드 링크에서 OS를 고르면 설치 안내가 그 OS를 듣고, 그만 들으면 알리지 않는다', () => {
    const page = new EventTarget();
    const heard: InstallerOs[] = [];

    const stop = onInstallOsChosen((os) => heard.push(os), page);
    announceInstallOs('windows', page);
    announceInstallOs('mac', page);
    stop();
    announceInstallOs('windows', page);

    expect(heard).toEqual(['windows', 'mac']);
  });
});
