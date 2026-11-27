import { copyFile, mkdir, mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProcessRunner } from '../agent/process-runner';
import { errorFields, type Logger } from '../logging/logger';

/** 사본에서 빼는 맨 위 항목. 사본에 `.git`이 없어 원격을 바꾸는 일이 생기지 않는다. */
const EXCLUDED_ENTRY = '.git';

/** 사본 하나를 만드는 데 기다리는 시간(밀리초). 큰 저장소의 APFS 복제도 몇 초면 끝난다(실측 6.1GB에 약 5초). */
const CLONE_TIMEOUT_MS = 5 * 60 * 1000;

/** `source` 아래 `names` 항목을 `destination` 아래 같은 이름으로 복제한다. 하나라도 못 하면 던진다. */
export type CloneEntries = (source: string, destination: string, names: readonly string[]) => Promise<void>;

/** 재현 사본에 필요한 것. */
export interface ReproductionCopiesOptions {
  /** 사본을 두는 폴더. 실행마다 이 아래에 다른 하위 폴더를 만든다. 앱을 켤 때 비운다. */
  root: string;
  /** 맨 위 항목을 복제하는 방법. 앱은 APFS 복제(`osascriptCloner`)를 쓴다. */
  clone: CloneEntries;
  /** 진단 로그. 경로는 남기지 않는다. */
  logger: Logger;
}

/**
 * 재현하는 진단이 도는 원본 저장소의 사본. 원본을 맨 위 항목마다 APFS 복제해 `.git`만 빼고 의존성 폴더와 커밋하지 않은 변경을 그대로 담는다.
 * 재현용 환경 파일을 지정했으면 그 파일이 사본의 `.env`가 된다. 원본은 읽기만 한다.
 * 사본 폴더는 홈 밖(OS 임시 폴더)에 둔다. Codex 권한 프로필은 홈 아래의 `.env`만 막을 수 있어, 사본의 `.env`를 열려면 사본이 홈 밖이어야 한다.
 */
export class ReproductionCopies {
  constructor(private readonly options: ReproductionCopiesOptions) {}

  /**
   * 사본을 만들고 그 실제 경로(링크를 푼 절대 경로)를 돌려준다. 실행마다 다른 경로다.
   * 만들지 못하면 만들다 만 사본을 지우고 던진다.
   * @param envFile 재현용 환경 파일. `null`이면 원본 `.env`를 그대로 쓴다.
   */
  async create(source: string, envFile: string | null): Promise<string> {
    await mkdir(this.options.root, { recursive: true });
    /** 이번 사본. 실제 경로로 푼다(실행기의 경계 규칙이 실제 경로로 맞춘다). */
    const copy = await realpath(await mkdtemp(join(this.options.root, 'run-')));
    try {
      /** 복제할 맨 위 항목. */
      const names = (await readdir(source)).filter((name) => name !== EXCLUDED_ENTRY);
      await this.options.clone(source, copy, names);
      if (envFile !== null) {
        // 원본 `.env`가 링크면 그 링크를 지우고 새 파일로 둔다. 링크를 따라 쓰면 링크가 가리키는 파일이 바뀐다.
        await rm(join(copy, '.env'), { force: true });
        await copyFile(envFile, join(copy, '.env'));
      }
      return copy;
    } catch (error) {
      await this.remove(copy);
      throw error;
    }
  }

  /** 사본을 지운다. 부르는 쪽은 끝나기를 기다리지 않는다. 실패해도 던지지 않고 다음 시작 때 비운다. */
  async remove(copy: string): Promise<void> {
    await rm(copy, { recursive: true, force: true }).catch((error: unknown) => this.options.logger.warn('reproduction.copy-remove-failed', errorFields(error)));
  }

  /** 사본 폴더를 비운다. 앱을 켤 때 부른다. 지난 실행이 지우다 만 사본이나 앱이 꺼지며 남은 사본이다. */
  async sweep(): Promise<void> {
    /** 남은 사본. */
    const entries = await readdir(this.options.root).catch(() => [] as string[]);
    await Promise.all(entries.map((name) => this.remove(join(this.options.root, name))));
    if (entries.length > 0) this.options.logger.info('reproduction.copies-swept', { count: entries.length });
  }
}

/**
 * `clonefile(2)`를 부르는 JXA 스크립트. 항목마다 한 번 불러 폴더를 통째로 복제하고, 실패한 항목 이름을 JSON으로 돌려준다.
 * Node에는 폴더를 한 번에 복제하는 호출이 없고(`fs.cp`는 파일마다 복제해 큰 저장소에서 1분 안팎), macOS에 늘 있는 osascript로 부른다.
 * `CLONE_NOFOLLOW`(1)로 심볼릭 링크는 링크 그대로 둔다.
 */
const CLONE_SCRIPT = `ObjC.bindFunction('clonefile', ['int', ['char *', 'char *', 'unsigned int']]);
function run(argv) {
  const source = argv[0];
  const destination = argv[1];
  const failed = [];
  for (const name of argv.slice(2)) {
    if ($.clonefile(source + '/' + name, destination + '/' + name, 1) !== 0) failed.push(name);
  }
  return JSON.stringify(failed);
}`;

/** osascript로 `clonefile(2)`를 불러 맨 위 항목을 APFS 복제한다(macOS). 같은 볼륨이 아니거나 APFS가 아니면 실패한다. */
export function osascriptCloner(runner: ProcessRunner): CloneEntries {
  return async (source, destination, names) => {
    if (names.length === 0) return;
    /** osascript 결과. */
    const result = await runner.run({
      command: '/usr/bin/osascript',
      args: ['-l', 'JavaScript', '-e', CLONE_SCRIPT, source, destination, ...names],
      env: { PATH: '/usr/bin:/bin' },
      cwd: destination,
      timeoutMs: CLONE_TIMEOUT_MS,
    });
    if (result.kind !== 'exited' || result.exitCode !== 0) throw new Error(`APFS 복제를 부르지 못했습니다(${result.kind}).`);
    /** 실패한 항목 이름. */
    const failed = JSON.parse(result.stdout.trim() || '[]') as unknown;
    if (!Array.isArray(failed) || failed.length > 0) throw new Error(`APFS 복제에 실패한 항목이 ${Array.isArray(failed) ? failed.length : '?'}개 있습니다.`);
  };
}
