import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { errorFields, type Logger } from '../logging/logger';
import type { CancelScheduled, Clock } from '../ports/clock';

/** 마이그레이션 전 사본을 두는 폴더 이름. 데이터 폴더 바로 아래에 있고, 그 안에 버전마다 `before-v<버전>` 폴더가 생긴다. */
export const BACKUPS_DIR_NAME = 'backups';

/** 사본 폴더 안에 두는, 새 버전이 정상으로 뜬 시각(Unix epoch 밀리초)을 적은 파일 이름. */
const HEALTHY_SINCE_FILE_NAME = 'healthy-since';
/** 하루(밀리초). */
const DAY_MS = 24 * 60 * 60 * 1000;
/** 새 버전이 정상으로 뜬 뒤 사본을 남기는 기간. 사본에는 Flow 원문과 초안이 들어 있어 오래 두지 않는다. */
const BACKUP_RETENTION_MS = 7 * DAY_MS;

/** 사본 정리에 필요한 것. */
export interface MigrationBackupsOptions {
  /** 데이터 폴더. */
  dataDir: string;
  /** 하루마다 정리를 예약하고 지난 시간을 재는 시계. */
  clock: Clock;
  /** 진단 로그. */
  logger: Logger;
}

/**
 * 마이그레이션 전 사본 정리. 사본은 새 버전이 정상으로 뜬 지 7일이 지나면 지운다. 복원 버튼은 없다(개발자 수동 복구용).
 * 앱이 시작을 마친 뒤 `start`를 부르면, 아직 시각이 없는 사본에 지금을 정상으로 뜬 시각으로 적는다. 그 뒤 앱을 켤 때와 하루에 한 번 지난 사본을 지운다.
 */
export class MigrationBackups {
  /** 다음 정리 예약을 지우는 함수. 멈춰 있으면 `null`. */
  private cancelScheduled: CancelScheduled | null = null;
  /** 진행 중인 정리. */
  private running: Promise<void> = Promise.resolve();

  constructor(private readonly options: MigrationBackupsOptions) {}

  /** 지금 정리하고 하루마다 다시 정리한다. 지금 정리가 끝나면 풀린다. */
  start(): Promise<void> {
    this.stop();
    return this.cleanUpAndSchedule();
  }

  /** 다음 정리를 멈춘다. 앱을 끝낼 때 부른다. */
  stop(): void {
    this.cancelScheduled?.();
    this.cancelScheduled = null;
  }

  /** 진행 중인 정리가 끝나면 풀린다. */
  whenIdle(): Promise<void> {
    return this.running;
  }

  /** 지금 정리하고 다음 정리를 하루 뒤로 예약한다. */
  private cleanUpAndSchedule(): Promise<void> {
    this.running = this.cleanUp();
    this.cancelScheduled = this.options.clock.after(DAY_MS, () => void this.cleanUpAndSchedule());
    return this.running;
  }

  /** 사본마다 정상으로 뜬 시각을 읽어(없으면 지금으로 적어) 7일이 지난 사본을 지운다. 실패해도 다음 정리에서 다시 한다. */
  private async cleanUp(): Promise<void> {
    /** 사본 폴더들의 부모. */
    const backupsDir = join(this.options.dataDir, BACKUPS_DIR_NAME);
    /** 지금 시각. */
    const now = this.options.clock.now();
    /** 버전마다의 사본 폴더 이름. */
    let names: string[];
    try {
      names = (await readdir(backupsDir, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.options.logger.warn('app-data.backup-list-failed', errorFields(error));
      return;
    }
    for (const name of names) {
      /** 사본 폴더. */
      const folder = join(backupsDir, name);
      try {
        /** 새 버전이 정상으로 뜬 시각. */
        const healthySince = (await readHealthySince(folder)) ?? (await writeHealthySince(folder, now));
        if (now - healthySince < BACKUP_RETENTION_MS) continue;
        await rm(folder, { recursive: true, force: true });
        this.options.logger.info('app-data.backup-deleted', { backup: name });
      } catch (error) {
        this.options.logger.warn('app-data.backup-cleanup-failed', { backup: name, ...errorFields(error) });
      }
    }
  }
}

/** 사본 폴더에 적은 정상으로 뜬 시각. 없거나 읽을 수 없으면 `null`. */
async function readHealthySince(folder: string): Promise<number | null> {
  try {
    /** 적은 시각. */
    const value = Number((await readFile(join(folder, HEALTHY_SINCE_FILE_NAME), 'utf8')).trim());
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

/** 사본 폴더에 정상으로 뜬 시각을 적고 그 시각을 돌려준다. */
async function writeHealthySince(folder: string, at: number): Promise<number> {
  await writeFile(join(folder, HEALTHY_SINCE_FILE_NAME), String(at));
  return at;
}
