import type { DetectionKey, DiagnosisRepoCheck, DiagnosisStatus, SentryDiagnosis, UnsavedDiagnosis } from '../sentry/sentry-diagnosis';

/** 한 프로젝트의 조회 한 번을 저장할 내용. */
export interface DetectionRecord {
  /** 등록한 Sentry 프로젝트 ID. */
  projectId: string;
  /** 새 체크포인트(Unix epoch 밀리초). 조회를 시작한 시각이다. */
  checkpoint: number;
  /** 기록할 중복 억제 키. 새 진단을 만든 키와 키만 기록하는 재발이 함께 든다. 이미 있는 키는 그대로 둔다. */
  keys: readonly DetectionKey[];
  /** 새로 만들 진단. 처음 보인 순서다. */
  diagnoses: readonly UnsavedDiagnosis[];
  /** 새 재발로 새 진단에 자리를 내주고 지울 진단 실패의 ID. 없으면 비어 있다. */
  replaced?: readonly number[];
}

/**
 * Sentry 진단 저장 포트(`state.db`의 `sentry_` 표). 프로젝트별 체크포인트, 중복 억제 기록, 진단을 다룬다.
 * Flow 계정과 무관하고, Flow 계정을 바꾸거나 계정 기록을 지워도 바뀌지 않는다. 상태 저장소 포트와 따로 둔다.
 */
export interface SentryStore {
  /** 프로젝트의 감지 체크포인트(Unix epoch 밀리초). 아직 조회에 성공한 적 없으면 `null`. */
  getCheckpoint(projectId: string): Promise<number | null>;
  /** 이 중복 억제 키를 이미 기록했는지 본다. */
  hasDetectionKey(key: DetectionKey): Promise<boolean>;
  /** 진단 전부. ID 순서다. */
  listDiagnoses(): Promise<SentryDiagnosis[]>;
  /** 조회 한 번의 결과(체크포인트, 중복 억제 키, 새 진단)를 한 트랜잭션으로 저장한다. 저장한 진단을 같은 순서로 돌려준다. */
  recordDetection(record: DetectionRecord): Promise<SentryDiagnosis[]>;
  /** 진단의 상태와 저장소 대기 사유를 바꾼다. */
  setDiagnosisStatus(id: number, status: DiagnosisStatus, repoCheck: DiagnosisRepoCheck | null): Promise<void>;
  /** 진단의 바뀌는 칸(상태, 저장소 대기 사유, 보고서, 실패, 실행 기록, 완료 시각)을 한 번에 쓴다. */
  updateDiagnosis(diagnosis: SentryDiagnosis): Promise<void>;
  /** 진단 하나를 지운다. 중복 억제 기록은 그대로 둔다. */
  removeDiagnosis(id: number): Promise<void>;
  /** 등록을 푼 프로젝트의 체크포인트와 중복 억제 기록, 주어진 상태의 진단을 한 트랜잭션으로 지운다. 지운 진단 ID를 돌려준다. */
  removeProject(projectId: string, statuses: readonly DiagnosisStatus[]): Promise<number[]>;
}
