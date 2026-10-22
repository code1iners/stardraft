// `pnpm release:keygen`의 본체. 저장소 주인이 업데이트 서명 키를 처음 한 번 만들고, 유출이 의심될 때만 --rotate로 새 키를 더한다.
// 개인 키는 메모리에서만 다루고 파일로 남기거나 화면에 내지 않는다. 바깥 경계(gh, 클립보드, 입력, 화면)는 주입받는다.
import { writeFile } from 'node:fs/promises';
import { generateSigningKeyPair, parsePublicKey } from '../src/core/update/update-signature.mts';
import { RELEASE_ENVIRONMENT, SIGNING_KEY_SECRETS } from './release-config.mts';

/** 키 생성이 닿는 바깥 경계. */
export type KeygenPorts = {
  /** Actions `release` 환경 비밀값을 등록한다. 값은 명령 인수가 아니라 표준 입력으로 넘긴다. 실패하면 거부한다. */
  setReleaseSecret(name: string, value: string): Promise<void>;
  /** 클립보드에 글을 넣는다. */
  copyToClipboard(text: string): Promise<void>;
  /** 클립보드를 비운다. */
  clearClipboard(): Promise<void>;
  /** 안내를 보이고 Enter를 기다린다. 사용자가 중단하면 거부한다. */
  waitForEnter(prompt: string): Promise<void>;
  /** 화면에 안내를 쓴다. 개인 키는 넘기지 않는다. */
  print(message: string): void;
};

/** 키 생성 입력. */
export type KeygenInput = {
  /** 키를 회전하는지(`--rotate`). */
  rotate: boolean;
  /** 지금 앱 소스의 공개 키 목록. */
  publicKeys: readonly string[];
  /** 공개 키 목록 파일 경로. */
  publicKeysFile: string;
};

/** 공개 키 목록 파일(`src/core/update/update-public-keys.mts`)의 내용. 이 스크립트가 파일을 통째로 다시 쓴다. */
export function renderPublicKeysModule(publicKeys: readonly string[]): string {
  /** 목록 항목 줄. */
  const items = publicKeys.map((publicKey) => `  '${publicKey}',\n`).join('');
  return [
    '// 앱 내 업데이트 파일의 서명을 검증하는 Ed25519 공개 키 목록이다. 앱과 태그 워크플로의 서명 재검증이 함께 쓴다.',
    '// `pnpm release:keygen`이 이 파일을 다시 쓴다. 손으로 고치는 것은 키 회전을 마치며 옛 키를 뺄 때뿐이다.',
    '// 목록이 비어 있으면 태그 워크플로가 서명을 검증하지 못해 Release를 만들지 않는다.',
    '',
    '/** Ed25519 공개 키(SPKI DER의 base64). 평소에는 하나이고, 키를 회전하는 동안에만 둘이다. */',
    `export const UPDATE_PUBLIC_KEYS: readonly string[] = [${items ? `\n${items}` : ''}];`,
    '',
  ].join('\n');
}

/** 오류에서 사람이 읽을 문구를 꺼낸다. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Ed25519 키 쌍을 메모리에서 만들어 개인 키를 `release` 환경 비밀값과 비밀번호 관리자에 두고, 공개 키를 공개 키 목록 파일에 쓴다.
 * 처음에는 첫째 비밀값에, --rotate면 둘째 비밀값에 등록하고 공개 키를 목록 뒤에 더한다. 커밋은 저장소 주인이 직접 한다.
 * 공개 키는 개인 키 보관을 마친 뒤 마지막에 쓴다. 중간에 멈추면 목록이 그대로라 다시 실행하면 새 키로 처음부터 이어진다.
 */
export async function runKeygen({ rotate, publicKeys, publicKeysFile }: KeygenInput, ports: KeygenPorts): Promise<void> {
  // 이미 쓰는 키를 덮으면 설치된 앱이 이후 업데이트를 모두 검증하지 못한다.
  if (!rotate && publicKeys.length > 0) {
    throw new Error('앱 소스의 공개 키 목록에 이미 키가 있습니다. 키를 바꾸려면 --rotate로 새 키를 더하세요. 새 키로 바꿔 쓰면 설치된 앱이 업데이트를 받지 못합니다.');
  }
  if (rotate && publicKeys.length === 0) throw new Error('아직 서명 키가 없습니다. --rotate 없이 실행하세요.');
  if (rotate && publicKeys.length > 1) {
    throw new Error('이미 키를 회전하는 중입니다(공개 키 2개). 팀원 PC가 새 공개 키를 넣은 버전으로 올라온 뒤 옛 키를 빼고 다시 실행하세요.');
  }
  // 목록에 키가 아닌 값이 있으면 그대로 옮겨 쓰지 않는다.
  for (const publicKey of publicKeys) parsePublicKey(publicKey);

  /** 개인 키를 둘 비밀값 이름. 처음에는 첫째, 회전할 때는 둘째다. */
  const secretName = rotate ? SIGNING_KEY_SECRETS[1] : SIGNING_KEY_SECRETS[0];
  /** 새 키 쌍. */
  const { publicKey, privateKey } = generateSigningKeyPair();

  try {
    await ports.setReleaseSecret(secretName, privateKey);
  } catch (error) {
    throw new Error(
      `비밀값 등록(gh secret set ${secretName} --env ${RELEASE_ENVIRONMENT})이 실패했습니다. gh 로그인 상태와 저장소에 ${RELEASE_ENVIRONMENT} 환경이 있는지 확인하세요. (${reasonOf(error)})`,
      { cause: error },
    );
  }
  ports.print(`${RELEASE_ENVIRONMENT} 환경 비밀값에 개인 키를 등록했습니다: ${secretName}`);

  // Actions 비밀값은 다시 읽을 수 없으므로, 잃어도 복구할 수 있게 비밀번호 관리자에 사본을 둔다.
  try {
    await ports.copyToClipboard(privateKey);
    await ports.waitForEnter('개인 키를 클립보드에 복사했습니다. 비밀번호 관리자에 붙여 넣어 저장한 뒤 Enter를 누르세요.');
  } catch (error) {
    throw new Error(
      `개인 키 보관을 마치지 못해 공개 키 목록은 바꾸지 않았습니다. ${RELEASE_ENVIRONMENT} 환경 비밀값(${secretName})은 이미 새 키로 바뀌었으니 다시 실행해 마치세요. (${reasonOf(error)})`,
      { cause: error },
    );
  } finally {
    await ports.clearClipboard();
  }
  ports.print('클립보드를 비웠습니다.');

  await writeFile(publicKeysFile, renderPublicKeysModule([...publicKeys, publicKey]));
  ports.print(`공개 키를 공개 키 목록에 썼습니다. 이 파일을 직접 커밋하세요: ${publicKeysFile}`);
  if (rotate) {
    ports.print(
      [
        '회전하는 동안 태그 워크플로가 두 키로 함께 서명합니다. 팀원 PC가 이 공개 키를 넣은 버전으로 올라온 뒤 회전을 마칩니다.',
        `  1. 공개 키 목록에서 옛 공개 키를 빼고 커밋합니다: ${publicKeys[0]}`,
        `  2. 비밀번호 관리자의 새 개인 키로 첫째 비밀값을 바꿉니다: gh secret set ${SIGNING_KEY_SECRETS[0]} --env ${RELEASE_ENVIRONMENT}`,
        `  3. 둘째 비밀값을 지웁니다: gh secret delete ${SIGNING_KEY_SECRETS[1]} --env ${RELEASE_ENVIRONMENT}`,
      ].join('\n'),
    );
  }
}
