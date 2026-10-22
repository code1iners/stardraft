import { basename } from 'node:path';
import type { DownloadedUpdate } from '../ports/update-feed';
import { computeFileSha512, isSignedByAnyKey, readSignatureList } from './update-signature.mts';

/** 받은 업데이트 파일을 설치 준비됨으로 둘 수 없는 까닭. 진단 로그에만 남고, 화면에는 모두 서명 검증 실패로 보인다. */
export type UpdateVerificationFailure =
  /** 안내의 버전이 지금 버전보다 높지 않다. */
  | 'not-newer'
  /** 안내의 파일 항목 중에 받은 파일 이름과 같은 항목이 없다. */
  | 'file-entry-missing'
  /** 그 파일 항목에 서명 목록이 없거나, 비었거나, 형식이 틀렸다. */
  | 'signatures-missing'
  /** 받은 파일을 읽지 못했다. */
  | 'file-unreadable'
  /** 받은 파일로 다시 만든 서명 문장을 어느 서명도 앱의 공개 키로 검증하지 못했다. sha512·버전·파일 이름 중 하나가 서명한 값과 다르거나 서명이 틀렸다. */
  | 'signature-mismatch';

/**
 * 다 받은 업데이트 파일을 검증한다. 아래 네 가지가 모두 맞아야 통과한다(ADR 0002).
 * - 받은 파일의 sha512를 직접 다시 계산한 값이 서명 문장과 같다.
 * - 서명 목록 중 하나가 공개 키 목록 중 하나로 검증된다.
 * - 서명 문장의 버전이 안내의 버전과 같고 지금 버전보다 높다.
 * - 서명 문장의 파일 이름이 받은 파일과 같다.
 * 서명 문장은 안내에서 읽지 않고 받은 파일로 다시 만든다. 버전은 안내의 버전, 파일 이름은 받은 파일의 이름, sha512는 다시 계산한 값이다.
 * 그래서 서명 검증 하나가 sha512·버전·파일 이름을 함께 확인하고, 지금 버전보다 높은지만 따로 본다.
 * 통과하면 `null`, 아니면 실패한 까닭을 돌려준다.
 */
export async function verifyDownloadedUpdate(
  { file, manifest }: DownloadedUpdate,
  currentVersion: string,
  publicKeys: readonly string[],
): Promise<UpdateVerificationFailure | null> {
  if (!isNewerVersion(manifest.version, currentVersion)) return 'not-newer';

  /** 받은 파일의 이름. 안내의 `url`이 아니라 실제로 받은 파일에서 읽어야 파일 이름 조건이 검사된다. */
  const fileName = basename(file);
  /** 받은 파일의 파일 항목. */
  const entry = manifest.files.find((item) => typeof item === 'object' && item !== null && Reflect.get(item, 'url') === fileName);
  if (entry === undefined) return 'file-entry-missing';

  /** 그 항목의 서명 목록. */
  const signatures = readSignatureList(entry);
  if (!signatures) return 'signatures-missing';

  /** 받은 파일의 sha512를 직접 다시 계산한 값. */
  let sha512: string;
  try {
    sha512 = await computeFileSha512(file);
  } catch {
    return 'file-unreadable';
  }
  return isSignedByAnyKey({ version: manifest.version, fileName, sha512 }, signatures, publicKeys) ? null : 'signature-mismatch';
}

/** `MAJOR.MINOR.PATCH` 버전의 모양. 사전 릴리스 버전은 배포에 쓰지 않으므로 받지 않는다. */
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** `candidate`가 `current`보다 높은 버전인지 본다. 둘 중 하나라도 `MAJOR.MINOR.PATCH`가 아니면 높지 않은 것으로 본다. */
function isNewerVersion(candidate: string, current: string): boolean {
  /** 숫자로 나눈 두 버전. */
  const [next, now] = [candidate, current].map((version) => VERSION_PATTERN.exec(version)?.slice(1).map(Number) ?? null);
  if (!next || !now) return false;
  for (let index = 0; index < next.length; index += 1) {
    /** 이 자리의 차이. */
    const diff = (next[index] ?? 0) - (now[index] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}
