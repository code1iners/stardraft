import type { SecretReadResult, SecretStore } from '../ports/secret-store';

/** 메모리에만 두는 비밀 저장소. `unreadable`을 켜면 복호화 실패를 흉내 낸다. */
export class MemorySecretStore implements SecretStore {
  /** 저장된 Flow 개인 API 키. */
  flowApiKey: string | null = null;
  /** 켜면 저장된 키가 있어도 풀 수 없는 것으로 응답한다. */
  unreadable = false;

  async readFlowApiKey(): Promise<SecretReadResult> {
    if (this.flowApiKey === null) return { kind: 'missing' };
    if (this.unreadable) return { kind: 'unreadable' };
    return { kind: 'found', value: this.flowApiKey };
  }

  async writeFlowApiKey(apiKey: string): Promise<void> {
    this.flowApiKey = apiKey;
    this.unreadable = false;
  }

  async deleteFlowApiKey(): Promise<void> {
    this.flowApiKey = null;
  }
}
