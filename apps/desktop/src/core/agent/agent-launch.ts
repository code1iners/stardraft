import type { ExecutorReport, RunKind } from '../ports/executor';
import type { ProcessRunner } from './process-runner';

/** 에이전트 CLI를 띄울 때 쓰는 것. 연결 확인이 정한다. */
export interface AgentLaunch {
  /** 설정에 저장한 CLI 절대 경로. 심볼릭 링크일 수 있다. */
  cliPath: string;
  /** 앱이 구성한 자식 프로세스 환경. */
  env: Record<string, string>;
  /** 연결 확인이 마지막으로 읽은 CLI 버전. 실행 이벤트가 버전을 알려 주지 않는 에이전트의 실행 기록에 쓴다. */
  version: string | null;
}

/** 실행 하나가 끝났을 때 연결 확인에 알리는 보고. */
export interface AgentRunReport extends ExecutorReport {
  /** 실행의 종류. */
  kind: RunKind;
}

/** 에이전트 실행기에 필요한 것. */
export interface AgentExecutorOptions {
  /** CLI를 띄우는 프로세스 실행기. */
  runner: ProcessRunner;
  /** 지금 쓸 CLI와 자식 환경. 연결 확인이 아직 CLI를 찾지 못했으면 `null`. */
  launch: () => AgentLaunch | null;
  /** 실행마다 지침·스키마 파일을 둘 임시 폴더를 만들 곳. 없으면 OS 임시 폴더다. */
  tempRoot?: string;
  /** 실행이 끝날 때마다 부른다. 연결 확인이 CLI 버전 변화와 전역 실패를 알아채는 데 쓴다. */
  onRunFinished?: (report: AgentRunReport) => void;
}
