/** 진단을 일으킨 감지의 갈래. 신규와 재발이다. 표에 그대로 남으므로 값을 바꾸지 않는다. */
export type DiagnosisOrigin = 'new' | 'regression';

/**
 * 진단의 상태. 이 단계에서는 진단이 실행되지 않아 대기와 저장소 대기(저장소 매핑 필요, 저장소 확인 필요)만 있다.
 * 진행 중, 검토 대기, 진단 실패, 완료는 그 상태를 만드는 단계가 더한다. 표의 상태 열에는 검사를 두지 않아 값을 더해도 표를 다시 만들지 않는다.
 */
export type DiagnosisStatus =
  /** 대기. 줄 서 있다. */
  | 'queued'
  /** 저장소 대기. 사유는 `repoCheck`다. */
  | 'repo-check-needed';

/** 저장소 대기의 사유. Flow 묶음과 이름·재개 방식이 같다. */
export type DiagnosisRepoCheck =
  /** 저장소 매핑 필요. 프로젝트에 매핑이 없다. 매핑을 저장하면 저절로 대기가 된다. */
  | { kind: 'unmapped' }
  /** 저장소 확인 필요. 매핑된 폴더가 없다. 폴더가 돌아오거나 매핑을 고치면 저절로 대기가 된다. */
  | { kind: 'missing-folder'; path: string };

/** 감지할 때 오류 이슈 목록과 등록에서 받아 둔 오류 이슈 정보. 상세의 `오류 정보`와 보고서의 오류 이슈 정보가 쓴다. */
export interface DiagnosisIssue {
  /** 짧은 ID. 없으면 빈 문자열. */
  shortId: string;
  /** 오류 제목. */
  title: string;
  /** 오류가 난 자리(culprit). 없으면 빈 문자열. */
  culprit: string;
  /** 레벨. 없으면 빈 문자열. */
  level: string;
  /** 등록의 환경 필터. `null`이면 모든 환경이다. */
  environment: string | null;
  /** 처음 보인 시각(Unix epoch 밀리초). 환경 필터가 있으면 그 환경 기준이다. */
  firstSeen: number;
  /** 마지막으로 보인 시각. 모르면 `null`. */
  lastSeen: number | null;
  /** 발생 수. 모르면 `null`. */
  count: number | null;
  /** 사용자 수. 모르면 `null`. */
  userCount: number | null;
  /** Sentry 화면 주소. 없으면 `null`. */
  permalink: string | null;
  /** 플랫폼. 없으면 `null`. */
  platform: string | null;
  /** 조직 이름. */
  organizationName: string;
  /** 프로젝트 이름. */
  projectName: string;
}

/** Sentry 진단 하나. 신규 또는 재발한 오류 이슈 하나에 하나다. 같은 오류 이슈의 진단이 여럿일 수 있다(검토 대기 중 재발 등). */
export interface SentryDiagnosis {
  /** 진단 ID. 생성 대기열의 대상 ID다. */
  id: number;
  /** 등록한 Sentry 프로젝트 ID. */
  projectId: string;
  /** 오류 이슈 ID. */
  issueId: string;
  /** 신규인지 재발인지. */
  origin: DiagnosisOrigin;
  /** 재발이면 재발을 일으킨 이벤트 ID. 신규면 `null`. */
  regressionEventId: string | null;
  /** 감지한 시각(Unix epoch 밀리초). */
  detectedAt: number;
  /** 상태. */
  status: DiagnosisStatus;
  /** 저장소 대기의 사유. 저장소 대기가 아니면 `null`. */
  repoCheck: DiagnosisRepoCheck | null;
  /** 오류 이슈 정보. */
  issue: DiagnosisIssue;
}

/** 아직 저장하지 않은 진단. */
export type UnsavedDiagnosis = Omit<SentryDiagnosis, 'id'>;

/**
 * 중복 억제 키. 신규는 오류 이슈 ID, 재발은 오류 이슈 ID와 재발을 일으킨 이벤트 ID다.
 * 재발 활동의 ID는 같은 재발인데도 달라질 수 있어 쓰지 않는다.
 */
export interface DetectionKey {
  /** 오류 이슈 ID. */
  issueId: string;
  /** 재발을 일으킨 이벤트 ID. 신규면 `null`. */
  eventId: string | null;
}

/** 저장소 대기인지 본다. */
export function isRepoWaiting(diagnosis: Pick<SentryDiagnosis, 'status'>): boolean {
  return diagnosis.status === 'repo-check-needed';
}

/**
 * 같은 오류 이슈에 새 재발이 왔을 때 새 진단을 만들지 않고 키만 기록하는 상태(스펙 5절 표의 첫 줄).
 * 저장소 대기와 대기다. 진행 중은 그 상태를 만드는 단계가 더한다.
 */
export function absorbsRegression(status: DiagnosisStatus): boolean {
  return status === 'queued' || status === 'repo-check-needed';
}

/** 등록을 풀 때 목록에서 조용히 빼는 상태. 검토 대기 보고서와 완료는 남는다. 진행 중과 진단 실패는 그 상태를 만드는 단계가 더한다. */
export const STATUSES_REMOVED_ON_UNREGISTER: readonly DiagnosisStatus[] = ['queued', 'repo-check-needed'];
