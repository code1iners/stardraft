import type { AsyncStringEncryption } from '../storage/file-secret-store';

/** 가짜 암호문의 앞머리. 뒤에 열쇠 세대와 base64 본문이 온다. */
const PREFIX = 'fake-v';

/**
 * OS 키 보관소 대신 쓰는 가역 암호화. 실제로 숨기지는 않고 평문을 base64로 바꿔 열쇠 세대를 붙인다.
 * `keyVersion`을 올리면 옛 세대의 암호문을 풀 때 `shouldReEncrypt`가 참이 되어, 열쇠가 바뀐 상황을 흉내 낸다.
 */
export class FakeEncryption implements AsyncStringEncryption {
  /** 지금 열쇠 세대. 암호화는 늘 이 세대로 한다. */
  keyVersion = 1;
  /** 켜면 암호화가 실패한다(키체인을 쓸 수 없음 등). */
  failEncrypt = false;
  /** 켜면 복호화가 실패한다(키체인 거부, 항목 삭제 등). */
  failDecrypt = false;
  /** 정하면 복호화가 이 약속이 끝날 때까지 기다린다. 읽기와 쓰기가 겹치는 순서를 만들 때 쓴다. */
  decryptGate: Promise<void> | null = null;
  /** 정하면 암호화가 이 약속이 끝날 때까지 기다린다. 저장이 겹치는 순서를 만들 때 쓴다. */
  encryptGate: Promise<void> | null = null;
  /** 암호화를 부른 횟수. */
  encryptCalls = 0;

  async encryptStringAsync(plainText: string): Promise<Buffer> {
    this.encryptCalls += 1;
    await this.encryptGate;
    if (this.failEncrypt) throw new Error('암호화를 쓸 수 없습니다.');
    return Buffer.from(`${PREFIX}${this.keyVersion}:${Buffer.from(plainText, 'utf8').toString('base64')}`, 'utf8');
  }

  async decryptStringAsync(encrypted: Buffer): Promise<{ shouldReEncrypt: boolean; result: string }> {
    await this.decryptGate;
    if (this.failDecrypt) throw new Error('암호문을 풀 수 없습니다.');

    /** 열쇠 세대와 본문. */
    const match = /^fake-v(\d+):([A-Za-z0-9+/=]*)$/.exec(encrypted.toString('utf8'));
    if (!match) throw new Error('알 수 없는 암호문입니다.');
    return {
      shouldReEncrypt: Number(match[1]) < this.keyVersion,
      result: Buffer.from(match[2] ?? '', 'base64').toString('utf8'),
    };
  }
}
