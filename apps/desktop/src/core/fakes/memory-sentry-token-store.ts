import type { SecretReadResult } from '../ports/secret-store';
import type { SentryTokenStore } from '../ports/sentry-token-store';

/** 메모리에만 두는 Sentry 토큰 저장소. `unreadable`을 켜면 복호화 실패를 흉내 낸다. */
export class MemorySentryTokenStore implements SentryTokenStore {
  /** 저장된 토큰. */
  token: string | null = null;
  /** 켜면 저장된 토큰이 있어도 풀 수 없는 것으로 응답한다. */
  unreadable = false;
  /** 켜면 저장이 실패한다. */
  failWrite = false;

  async read(): Promise<SecretReadResult> {
    if (this.token === null) return { kind: 'missing' };
    if (this.unreadable) return { kind: 'unreadable' };
    return { kind: 'found', value: this.token };
  }

  async write(token: string): Promise<void> {
    if (this.failWrite) throw new Error('저장할 수 없습니다.');
    this.token = token;
    this.unreadable = false;
  }

  async delete(): Promise<void> {
    this.token = null;
  }
}
