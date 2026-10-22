import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * 앱이 스스로 바꿀 수 없는 위치의 까닭. 화면의 사유 문구가 다르다.
 * - `read-only`: 읽기 전용 볼륨(DMG 안, App Translocation)에서 실행 중이다. "응용 프로그램 폴더로 옮긴 뒤 다시 여세요"
 * - `no-permission`: 번들이나 부모 폴더에 쓸 권한이 없다. "이 계정은 Stardraft를 바꿀 권한이 없습니다"
 */
export type BlockedLocationReason = 'read-only' | 'no-permission';

/** Gatekeeper가 앱을 옮겨 실행하는(App Translocation) 읽기 전용 위치의 경로 조각. */
const TRANSLOCATION_SEGMENT = '/AppTranslocation/';

/**
 * macOS 앱 번들이 놓인 곳을 앱이 스스로 바꿀 수 있는지 본다. 바꿀 수 있으면 `null`, 아니면 그 까닭이다.
 * Squirrel.Mac은 읽기 전용 볼륨이면 업데이트를 거부하고, 번들이나 부모 폴더에 쓸 수 없으면 관리자 인증 창을 띄운다. 이 두 조건을 미리 본다.
 * 쓰기 확인이 읽기 전용 파일 시스템(EROFS)으로 실패하면 읽기 전용이고, 그 밖의 까닭으로 실패하면 권한이 없는 것으로 본다.
 */
export async function checkInstallLocation(bundlePath: string): Promise<BlockedLocationReason | null> {
  if (bundlePath.includes(TRANSLOCATION_SEGMENT)) return 'read-only';

  /** 번들과 부모 폴더의 쓰기 확인이 실패한 오류 코드. 쓸 수 있으면 `null`. */
  const failures = await Promise.all([bundlePath, dirname(bundlePath)].map(writeAccessFailure));
  if (failures.includes('EROFS')) return 'read-only';
  return failures.some((code) => code !== null) ? 'no-permission' : null;
}

/** `path`에 쓸 수 있는지 본다. 쓸 수 있으면 `null`, 아니면 오류 코드다. */
async function writeAccessFailure(path: string): Promise<string | null> {
  try {
    await access(path, constants.W_OK);
    return null;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code ?? 'UNKNOWN';
  }
}

/** macOS 실행 파일 경로(`…/Stardraft.app/Contents/MacOS/Stardraft`)에서 앱 번들 경로를 얻는다. 앱 번들 안의 실행 파일이 아니면 `null`. */
export function macBundlePathOf(execPath: string): string | null {
  return /^(.+\.app)\/Contents\/MacOS\/[^/]+$/.exec(execPath)?.[1] ?? null;
}
