import type { SecretReadResult } from './secret-store';

/** Sentry 개인 토큰 저장소 포트. Flow 키와 같은 방식으로 OS 키 보관소로 암호화해 별도 파일에 둔다. */
export interface SentryTokenStore {
  /** 저장된 토큰을 읽는다. */
  read(): Promise<SecretReadResult>;
  /** 확인에 성공한 토큰을 저장한다. */
  write(token: string): Promise<void>;
  /** 저장된 토큰을 지운다. */
  delete(): Promise<void>;
}
