import { describe, expect, it } from 'vitest';
import { UPDATE_PUBLIC_KEYS } from './update-public-keys.mts';
import { parsePublicKey } from './update-signature.mts';

describe('앱 소스의 공개 키 목록', () => {
  it('모두 Ed25519 공개 키이고, 겹치지 않으며, 회전 중에도 둘을 넘지 않는다', () => {
    for (const publicKey of UPDATE_PUBLIC_KEYS) expect(() => parsePublicKey(publicKey)).not.toThrow();
    expect(new Set(UPDATE_PUBLIC_KEYS).size).toBe(UPDATE_PUBLIC_KEYS.length);
    expect(UPDATE_PUBLIC_KEYS.length).toBeLessThanOrEqual(2);
  });
});
