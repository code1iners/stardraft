/** 자식 프로세스 하나를 띄우는 요청. */
export interface ProcessRequest {
  /** 실행할 파일의 절대 경로. */
  command: string;
  /** 인수 목록. 셸을 거치지 않고 그대로 넘긴다. */
  args: string[];
  /** 자식 프로세스의 환경 변수 전체. 앱의 환경을 물려주지 않고 이 값만 쓴다. */
  env: Record<string, string>;
  /** 작업 폴더. */
  cwd: string;
  /** 제한 시간(밀리초). 넘기면 프로세스 트리를 끝내고 `timed-out`으로 끝난다. */
  timeoutMs: number;
}

/** 자식 프로세스 하나를 띄운 결과. 출력은 길이 상한까지만 담는다. */
export type ProcessResult =
  /** 프로세스가 스스로 끝났다. 신호로 끝났으면 `exitCode`는 `null`이다. */
  | { kind: 'exited'; exitCode: number | null; stdout: string; stderr: string }
  /** 제한 시간을 넘겨 끝냈다. 그때까지 받은 출력을 담는다. */
  | { kind: 'timed-out'; stdout: string; stderr: string }
  /** 프로세스를 띄우지 못했다(파일 없음, 실행 권한 없음 등). */
  | { kind: 'spawn-failed'; message: string };

/**
 * 프로세스 실행기. 에이전트 CLI와 로그인 셸을 띄우는 바깥 경계다.
 * 테스트는 가짜 실행기를 꽂아 실제 CLI를 부르지 않는다.
 */
export interface ProcessRunner {
  /** 프로세스를 띄우고 끝날 때까지 기다린다. 실패도 결과로 돌려주고 던지지 않는다. */
  run(request: ProcessRequest): Promise<ProcessResult>;
}
