/** 저장된 비밀값을 읽은 결과. */
export type SecretReadResult =
  /** 저장된 값이 없다. */
  | { kind: 'missing' }
  /** 복호화한 값. */
  | { kind: 'found'; value: string }
  /** 저장돼 있지만 풀 수 없다(키체인 거부, 항목 삭제, 다른 PC로 복사). "키 확인 필요"로 이어진다. */
  | { kind: 'unreadable' };

/** 비밀 저장소 포트. Flow 개인 API 키를 OS 키 보관소로 암호화해 둔다. */
export interface SecretStore {
  /** 저장된 Flow 개인 API 키를 읽는다. */
  readFlowApiKey(): Promise<SecretReadResult>;
  /** 확인에 성공한 Flow 개인 API 키를 저장한다. */
  writeFlowApiKey(apiKey: string): Promise<void>;
  /** 저장된 Flow 개인 API 키를 지운다. */
  deleteFlowApiKey(): Promise<void>;
}
