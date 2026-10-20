import { readFile, rm } from 'node:fs/promises';
import { errorFields, type Logger } from '../logging/logger';
import type { SecretReadResult, SecretStore } from '../ports/secret-store';
import { SerialQueue } from '../serial-queue';
import { writeFileAtomic } from './atomic-file';

/**
 * OS 키 보관소(macOS 키체인, Windows DPAPI)에 묶인 문자열 암호화. Electron `safeStorage`의 비동기 API와 모양이 같다.
 * 동기 API는 쓰지 않으므로 받지 않는다.
 */
export interface AsyncStringEncryption {
  /** 문자열을 암호화한다. */
  encryptStringAsync(plainText: string): Promise<Buffer>;
  /** 암호문을 푼다. `shouldReEncrypt`가 참이면 열쇠가 바뀐 것이라 새로 암호화해 둬야 한다. */
  decryptStringAsync(encrypted: Buffer): Promise<{ shouldReEncrypt: boolean; result: string }>;
}

/**
 * Flow 개인 API 키를 OS 키 보관소로 암호화해 데이터 폴더의 파일 하나에 두는 비밀 저장소.
 * 읽기·쓰기·지우기는 부른 순서대로 하나씩 한다. 읽으면서 옛 키를 다시 암호화해 저장하는 일이
 * 그 사이에 저장한 새 키를 덮어쓰지 않게 하기 위해서다.
 */
export class FileSecretStore implements SecretStore {
  /** 키 파일을 읽고 쓰는 차례. */
  private readonly queue = new SerialQueue();

  /**
   * @param filePath 암호문을 둘 파일.
   * @param encryption OS 키 보관소에 묶인 암호화.
   * @param logger 진단 로그. 키는 남기지 않는다.
   */
  constructor(
    private readonly filePath: string,
    private readonly encryption: AsyncStringEncryption,
    private readonly logger: Logger,
  ) {}

  readFlowApiKey(): Promise<SecretReadResult> {
    return this.queue.run(() => this.read());
  }

  writeFlowApiKey(apiKey: string): Promise<void> {
    return this.queue.run(() => this.write(apiKey));
  }

  deleteFlowApiKey(): Promise<void> {
    return this.queue.run(() => rm(this.filePath, { force: true }));
  }

  /** 키 파일을 읽어 푼다. 열쇠가 바뀌었으면 새 열쇠로 다시 저장한다. */
  private async read(): Promise<SecretReadResult> {
    /** 파일의 암호문. */
    let encrypted: Buffer;
    try {
      encrypted = await readFile(this.filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' };
      this.logger.warn('secret.read-failed', errorFields(error));
      return { kind: 'unreadable' };
    }

    /** 푼 결과. */
    let decrypted: { shouldReEncrypt: boolean; result: string };
    try {
      decrypted = await this.encryption.decryptStringAsync(encrypted);
    } catch (error) {
      // 키체인 거부, 항목 삭제, 다른 PC에서 복사한 파일이 여기로 온다. 오류 문구에는 키가 들어 있지 않다.
      this.logger.warn('secret.decrypt-failed', errorFields(error));
      return { kind: 'unreadable' };
    }

    if (decrypted.shouldReEncrypt) await this.reEncrypt(decrypted.result);
    return { kind: 'found', value: decrypted.result };
  }

  /** 키를 암호화해 임시 파일에 쓴 뒤 이름을 바꿔 저장한다. 암호화에 실패하면 옛 파일을 건드리지 않는다. */
  private async write(apiKey: string): Promise<void> {
    await writeFileAtomic(this.filePath, await this.encryption.encryptStringAsync(apiKey));
  }

  /** 열쇠가 바뀐 키를 새 열쇠로 암호화해 다시 저장한다. 실패해도 옛 암호문은 그대로 풀리므로 로그만 남긴다. */
  private async reEncrypt(apiKey: string): Promise<void> {
    try {
      await this.write(apiKey);
      this.logger.info('secret.re-encrypted');
    } catch (error) {
      this.logger.warn('secret.re-encrypt-failed', errorFields(error));
    }
  }
}
