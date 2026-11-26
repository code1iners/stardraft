/** 실행 중인 자식 프로세스의 표준 입력. */
export interface ProcessInput {
  /** 자식에게 `text`를 쓴다. 입력이 이미 닫혔거나 프로세스가 끝났으면 쓰지 않고 `false`다. */
  write(text: string): boolean;
  /** 표준 입력을 닫는다. 이미 닫혔으면 아무 일도 하지 않는다. */
  end(): void;
}

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
  /** 표준 입력에 쓸 내용. 없으면 아무것도 쓰지 않는다. `onStdin`이 없으면 쓴 뒤 바로 닫는다. */
  stdin?: string;
  /**
   * 있으면 `stdin`을 쓴 뒤에도 표준 입력을 닫지 않고, 프로세스를 띄운 직후 이 입력을 넘겨 부른다. 실행 중에 입력을 더 보내야 하는 실행(실행 중 전달)이 쓴다.
   * 입력은 `end`를 부르거나 프로세스가 끝나면 닫힌다.
   */
  onStdin?: (input: ProcessInput) => void;
  /** 표준 출력을 줄 단위로 받는다. 줄 끝의 `\r`은 뗀다. 결과의 `stdout`과 달리 길이 상한 없이 모든 줄을 넘긴다. */
  onStdoutLine?: (line: string) => void;
  /** 중단 신호. 오면 프로세스 트리를 끝내고 `aborted`로 끝난다. */
  signal?: AbortSignal;
  /**
   * 제한 시간이나 중단 신호로 끝낼 때 자식의 자손이 만든 다른 프로세스 그룹까지 끝낼지 여부.
   * 셸 명령이나 MCP 서버처럼 자기 그룹을 따로 만드는 자손은 자식의 그룹만 끝내면 남는다. POSIX에서만 쓴다.
   */
  killDescendants?: boolean;
}

/** 자식 프로세스 하나를 띄운 결과. 출력은 길이 상한까지만 담는다. */
export type ProcessResult =
  /** 프로세스가 스스로 끝났다. 신호로 끝났으면 `exitCode`는 `null`이다. */
  | { kind: 'exited'; exitCode: number | null; stdout: string; stderr: string }
  /** 제한 시간을 넘겨 끝냈다. 그때까지 받은 출력을 담는다. */
  | { kind: 'timed-out'; stdout: string; stderr: string }
  /** 중단 신호를 받아 끝냈다. 그때까지 받은 출력을 담는다. */
  | { kind: 'aborted'; stdout: string; stderr: string }
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
