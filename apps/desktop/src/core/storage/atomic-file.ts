import { randomUUID } from 'node:crypto';
import { open, rename, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

/**
 * 파일을 원자적으로 바꾼다. 같은 폴더의 임시 파일에 다 쓰고 디스크에 내린 뒤 이름을 바꾼다.
 * 쓰는 도중 앱이 꺼지거나 디스크가 차도 원래 파일은 온전히 남는다. 문자열은 UTF-8로, 바이트는 그대로 쓴다.
 */
export async function writeFileAtomic(filePath: string, data: string | Uint8Array): Promise<void> {
  /** 원래 파일과 같은 폴더의 임시 파일. 이름 바꾸기가 같은 볼륨 안에서 일어나야 원자적이다. */
  const tempPath = join(dirname(filePath), `.${basename(filePath)}.${randomUUID()}.tmp`);
  try {
    /** 임시 파일 핸들. */
    const handle = await open(tempPath, 'w', 0o600);
    try {
      await handle.writeFile(data, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}
