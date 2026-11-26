import { copyFile, lstat, mkdir, mkdtemp, readdir, realpath, rename, rm } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { matchesSecretPattern, withDefaultSecretPatterns } from '../agent/secret-patterns';

/** 앱 데이터 폴더 아래 첨부 폴더의 이름. 진단마다 하위 폴더 하나를 둔다. */
const ATTACHMENTS_DIR_NAME = 'diagnosis-attachments';

/** 옮겨 두는 첨부를 담는 하위 폴더 이름의 앞부분. 진단 ID가 아니라 앱을 켤 때 표에 없는 폴더로 치워진다. */
const STAGING_PREFIX = 'staging-';

/** 첨부로 받는 확장자. 이미지(`png`·`jpg`)와 텍스트 로그(`log`·`txt`)다. `jpeg`는 `jpg`와 같은 종류로 본다. */
const ATTACHMENT_EXTENSIONS: readonly string[] = ['.png', '.jpg', '.jpeg', '.log', '.txt'];

/** 보고서 하나의 첨부 최대 수. */
export const MAX_ATTACHMENTS = 10;

/** 보고서 하나의 첨부 합계 최대 크기(바이트). */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

/** 진단 보고서에 딸린 첨부 파일 하나. 표에는 이름과 크기만 적는다. */
export interface DiagnosisAttachment {
  /** 진단 폴더 안의 파일 이름. */
  name: string;
  /** 크기(바이트). */
  sizeBytes: number;
}

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

  /**
   * 재현 첨부를 옮겨 둘 빈 폴더를 만든다. 보고서를 저장한 뒤 `replace`로 진단 폴더에 넣는다.
   * 진단 폴더에 바로 옮기지 않는 까닭: 다시 진단이 성공하면 앞선 첨부를 지우는데, 그 전에 같은 폴더에 넣으면 새 첨부도 함께 지워진다.
   */
  async createStaging(): Promise<string> {
    await mkdir(this.root, { recursive: true });
    return mkdtemp(join(this.root, STAGING_PREFIX));
  }

  /** 진단의 첨부를 바꾼다. 앞선 첨부 폴더를 지운 뒤 옮겨 둔 폴더(`null`이면 첨부 없음)를 진단 폴더로 넣는다. */
  async replace(diagnosisId: number, staged: string | null): Promise<void> {
    await this.remove(diagnosisId);
    if (staged !== null) await rename(staged, this.dirOf(diagnosisId));
  }

  /** 넣지 않을 옮겨 둔 폴더를 지운다. 이미 넣었거나 없으면 아무것도 하지 않는다. */
  async discard(staged: string): Promise<void> {
    await rm(staged, { recursive: true, force: true });
  }

  /** 진단의 첨부 파일 이름. 이름 순서이고 폴더나 숨김 파일은 뺀다. 폴더가 없으면 비어 있다. */
  async list(diagnosisId: number): Promise<string[]> {
    /** 폴더 안의 항목. 폴더가 없으면 비어 있다. */
    const entries = await readdir(this.dirOf(diagnosisId), { withFileTypes: true }).catch(() => []);
    return entries
      .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
      .sort();
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

/** 재현 첨부 옮기기의 입력. */
export interface StageAttachmentsInput {
  /** 재현 사본의 실제 경로. 첨부는 이 안의 파일만 받는다. */
  copyRoot: string;
  /** 에이전트가 적은 첨부 경로. 사본 안의 절대 경로나 사본 루트 기준 상대 경로다. */
  paths: readonly string[];
  /** 옮겨 둘 폴더(`createStaging`). */
  stagingDir: string;
  /** 사용자가 더한 비밀 파일 패턴. 기본 목록은 늘 함께 본다(`.env` 계열 포함). */
  secretPatterns: readonly string[];
}

/**
 * 재현 사본에서 첨부를 옮겨 둔다. 사본을 지우기 전에 부른다. 허용한 종류이고 한도(10개, 합계 20MB) 안의 것만 적힌 순서대로 옮기고,
 * 옮기지 않은 것(종류가 다름, 한도를 넘음, 없음, 사본 밖, 링크, 비밀 파일 패턴)은 생략한 수로 센다. 같은 파일을 두 번 적으면 한 번만 센다.
 * 링크는 따라가지 않는다(사본 밖 파일을 첨부로 빼내지 못하게). 이름이 겹치면 `-2`, `-3`을 붙인다.
 */
export async function stageReproductionAttachments({ copyRoot, paths, stagingDir, secretPatterns }: StageAttachmentsInput): Promise<{ attachments: DiagnosisAttachment[]; omitted: number }> {
  /** 사본의 실제 경로. */
  const root = await realpath(copyRoot);
  /** 볼 비밀 파일 패턴. */
  const patterns = withDefaultSecretPatterns(secretPatterns);
  /** 옮긴 첨부. */
  const attachments: DiagnosisAttachment[] = [];
  /** 이미 본 파일의 실제 경로. */
  const seen = new Set<string>();
  /** 옮긴 크기 합. */
  let total = 0;
  /** 생략한 수. */
  let omitted = 0;
  for (const path of paths) {
    /** 사본 안 실제 경로와 크기. 받을 수 없으면 `null`. */
    const file = await acceptableFile(root, path, patterns);
    if (file !== null && seen.has(file.path)) continue;
    if (file === null || attachments.length >= MAX_ATTACHMENTS || total + file.size > MAX_ATTACHMENT_BYTES) {
      omitted += 1;
      continue;
    }
    seen.add(file.path);
    /** 진단 폴더 안의 이름. */
    const name = uniqueName(basename(file.path), attachments);
    await copyFile(file.path, join(stagingDir, name));
    attachments.push({ name, sizeBytes: file.size });
    total += file.size;
  }
  return { attachments, omitted };
}

/** 사본 안의 첨부로 받을 수 있는 파일이면 실제 경로와 크기, 아니면 `null`. */
async function acceptableFile(root: string, path: string, patterns: readonly string[]): Promise<{ path: string; size: number } | null> {
  /** 사본 기준으로 푼 경로. */
  const absolute = isAbsolute(path) ? path : resolve(root, path);
  if (!ATTACHMENT_EXTENSIONS.includes(extname(absolute).toLowerCase())) return null;
  /** 파일 자체의 정보. 링크면 받지 않는다. */
  const info = await lstat(absolute).catch(() => null);
  if (!info?.isFile()) return null;
  /** 중간 폴더의 링크까지 푼 실제 경로. */
  const real = await realpath(absolute).catch(() => null);
  if (real === null || !real.startsWith(`${root}${sep}`)) return null;
  if (matchesSecretPattern(relative(root, real).split(sep).join('/'), patterns)) return null;
  return { path: real, size: info.size };
}

/** 겹치지 않는 이름. 겹치면 확장자 앞에 `-2`, `-3`을 붙인다. */
function uniqueName(name: string, taken: readonly DiagnosisAttachment[]): string {
  /** 확장자. */
  const extension = extname(name);
  /** 확장자를 뺀 이름. */
  const stem = name.slice(0, name.length - extension.length);
  for (let number = 1; ; number += 1) {
    /** 후보 이름. */
    const candidate = number === 1 ? name : `${stem}-${number}${extension}`;
    if (!taken.some((item) => item.name === candidate)) return candidate;
  }
}
