import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

/** 앱 데이터 폴더 아래 첨부 폴더의 이름. 진단마다 하위 폴더 하나를 둔다. */
const ATTACHMENTS_DIR_NAME = 'diagnosis-attachments';

/**
 * 진단 첨부 파일이 놓이는 폴더. 첨부의 저장 위치를 정하는 곳은 여기 하나다.
 * 진단마다 `<앱 데이터>/diagnosis-attachments/<진단 ID>/` 폴더를 쓰고, 표에는 파일 이름과 크기만 적는다.
 * 완료할 때 그 진단의 폴더를 지우고, 앱을 켤 때 표에 없는 진단의 폴더를 치운다.
 */
export class DiagnosisAttachmentFolders {
  /** 첨부 폴더들을 담는 폴더. */
  private readonly root: string;

  constructor(dataDir: string) {
    this.root = join(dataDir, ATTACHMENTS_DIR_NAME);
  }

  /** 진단의 첨부 폴더 경로. 폴더가 아직 없을 수 있다. */
  dirOf(diagnosisId: number): string {
    return join(this.root, String(diagnosisId));
  }

  /** 진단의 첨부 폴더를 지운다. 폴더가 없으면 아무것도 하지 않는다. */
  async remove(diagnosisId: number): Promise<void> {
    await rm(this.dirOf(diagnosisId), { recursive: true, force: true });
  }

  /** 표에 없는 진단의 첨부 폴더를 치운다. 지운 폴더 수를 돌려준다. 첨부 폴더를 담는 폴더가 없으면 0이다. */
  async removeUnknown(knownIds: Iterable<number>): Promise<number> {
    /** 표에 있는 진단 폴더 이름. */
    const known = new Set([...knownIds].map(String));
    /** 담는 폴더 안의 항목. 폴더가 없으면 비어 있다. */
    const entries = await readdir(this.root).catch(() => [] as string[]);
    /** 지울 항목. */
    const unknown = entries.filter((name) => !known.has(name));
    await Promise.all(unknown.map((name) => rm(join(this.root, name), { recursive: true, force: true })));
    return unknown.length;
  }
}
