import { isAbsolute } from 'node:path';
import { errorFields, type Logger } from '../logging/logger';
import type { Clock } from '../ports/clock';
import type { SettingsStore } from '../ports/settings-store';
import { SerialQueue } from '../serial-queue';
import { exportDiagnosisReport, type ExportedDiagnosisReport } from './diagnosis-export';
import type { SentryDiagnoses } from './sentry-diagnoses';

/** 보고서를 내보낼 폴더 설정에 필요한 것. */
export interface DiagnosisReportFolderOptions {
  /** 폴더를 두는 설정 저장소. */
  settingsStore: SettingsStore;
  /** 고르지 않았을 때의 폴더(사용자 문서 폴더 아래 `Stardraft/Reports/Sentry`). */
  defaultFolder: string;
  /** 진단 로그. 폴더 경로는 남기지 않는다. */
  logger: Logger;
}

/**
 * 설정 "Sentry" 칸의 "보고서를 내보낼 폴더". 앱 전체 설정이고 하나뿐이다. 고르지 않았으면 기본 폴더다.
 * 바꾸는 즉시 `settings.json`에 저장하고 알린다.
 */
export class DiagnosisReportFolder {
  /** 설정에서 읽어 둔 값. 고르지 않았으면 `null`. */
  private saved: string | null = null;
  /** 설정을 읽고 저장하는 일을 하나씩 하는 줄. */
  private readonly lane = new SerialQueue();
  /** 값이 바뀔 때 부를 함수. */
  private readonly listeners = new Set<() => void>();

  constructor(private readonly options: DiagnosisReportFolderOptions) {}

  /** 저장된 폴더를 읽는다. 절대 경로가 아닌 값(손으로 고친 파일)은 고르지 않은 것으로 읽는다. */
  async load(): Promise<void> {
    this.saved = validFolder((await this.options.settingsStore.load()).diagnosisReportFolder);
  }

  /** 지금 내보낼 폴더. 고르지 않았으면 기본 폴더다. */
  path(): string {
    return this.saved ?? this.options.defaultFolder;
  }

  /** 기본 폴더를 쓰는 중인지 본다. */
  isDefault(): boolean {
    return this.saved === null;
  }

  /** 값이 바뀔 때마다 `listener`를 부른다. 돌려준 함수를 부르면 그만 부른다. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 폴더를 바꾼다. 절대 경로가 아니면 받지 않는다. 기본 폴더와 같은 경로를 고르면 고르지 않은 것으로 둔다. 저장하지 못하면 로그만 남기고 그대로 둔다. */
  set(path: string): Promise<void> {
    return this.lane.run(async () => {
      /** 저장할 값. */
      const next = validFolder(path);
      if (next === null) {
        this.options.logger.warn('diagnosis-report-folder.rejected');
        return;
      }
      /** 기본 폴더와 같으면 `null`로 저장한다. */
      const stored = next === this.options.defaultFolder ? null : next;
      if (stored === this.saved) return;
      try {
        // 다른 칸의 변경을 덮지 않게 저장 직전에 설정을 다시 읽는다.
        /** 저장 직전의 설정. */
        const settings = await this.options.settingsStore.load();
        await this.options.settingsStore.save({ ...settings, diagnosisReportFolder: stored });
      } catch (error) {
        this.options.logger.error('diagnosis-report-folder.save-failed', errorFields(error));
        return;
      }
      this.saved = stored;
      this.options.logger.info('diagnosis-report-folder.changed');
      for (const listener of this.listeners) listener();
    });
  }
}

/** 설정에서 읽은 폴더 값. 비어 있지 않은 절대 경로만 받는다. */
function validFolder(value: unknown): string | null {
  return typeof value === 'string' && value !== '' && isAbsolute(value) ? value : null;
}

/** 진단 보고서 내보내기에 필요한 것. */
export interface DiagnosisExportsOptions {
  /** 보고서를 가진 진단 목록. 내보낸 기록도 여기에 남긴다. */
  diagnoses: SentryDiagnoses;
  /** 내보낼 폴더. */
  folder: Pick<DiagnosisReportFolder, 'path'>;
  /** 진단의 첨부 폴더와 그 안의 파일 이름. */
  attachments: {
    /** 진단의 첨부 폴더 경로. */
    dirOf: (diagnosisId: number) => string;
    /** 진단의 첨부 파일 이름. */
    list: (diagnosisId: number) => Promise<string[]>;
  };
  /** 내보낸 시각을 읽는 시계. */
  clock: Clock;
  /** 진단 로그. 폴더 경로와 파일 이름은 남기지 않는다. */
  logger: Logger;
}

/**
 * 진단 보고서 내보내기. 검토 대기 보고서를 설정의 폴더에 마크다운 파일로 만들고 내보낸 기록을 남긴다.
 * 선택 동작이라 상태를 바꾸지 않고 몇 번이든 할 수 있다. 같은 진단을 거듭 내보내면 파일이 `-2`, `-3`으로 늘어난다.
 */
export class DiagnosisExports {
  /** 내보내기를 하나씩 한다. 같은 이름을 두고 겹쳐 다투지 않게 한다. */
  private readonly lane = new SerialQueue();

  constructor(private readonly options: DiagnosisExportsOptions) {}

  /**
   * 진단의 보고서를 내보낸다. 검토 대기 보고서가 없으면 아무것도 하지 않고 `null`이다.
   * 파일을 만들지 못하면 오류를 던진다. 파일은 만들었지만 기록을 남기지 못한 경우(그사이 완료함)는 파일을 그대로 두고 결과를 돌려준다.
   */
  export(diagnosisId: number): Promise<ExportedDiagnosisReport | null> {
    return this.lane.run(async () => {
      /** 내보낼 진단. */
      const diagnosis = this.options.diagnoses.get(diagnosisId);
      if (!diagnosis || diagnosis.status !== 'ready' || diagnosis.report === null) return null;
      /** 만든 파일. */
      const exported = await exportDiagnosisReport({
        diagnosis,
        folder: this.options.folder.path(),
        attachmentNames: await this.options.attachments.list(diagnosisId),
        attachmentsDir: this.options.attachments.dirOf(diagnosisId),
      });
      await this.options.diagnoses.recordExport(diagnosisId, {
        path: exported.path,
        at: this.options.clock.now(),
        reportCreatedAt: diagnosis.report.run.createdAt,
      });
      this.options.logger.info('diagnosis-exports.exported', { diagnosisId });
      return exported;
    });
  }
}
