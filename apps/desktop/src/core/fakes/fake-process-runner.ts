import type { ProcessRequest, ProcessResult, ProcessRunner } from '../agent/process-runner';

/** 가짜 실행기가 요청 하나에 돌려줄 결과. 함수면 요청을 보고 결과를 만든다. */
export type FakeProcessReply = ProcessResult | ((request: ProcessRequest) => ProcessResult | Promise<ProcessResult>);

/** 가짜 실행기의 대답 규칙 하나. */
interface FakeProcessRule {
  /** 이 규칙이 맡는 요청인지 본다. */
  matches: (request: ProcessRequest) => boolean;
  /** 맡은 요청에 돌려줄 결과. */
  reply: FakeProcessReply;
}

/**
 * 규칙대로 대답하는 프로세스 실행기. 실제 프로세스는 띄우지 않는다.
 * 나중에 더한 규칙이 앞선다. 맞는 규칙이 없으면 파일이 없는 것처럼 `spawn-failed`로 끝난다.
 * 요청이 표준 출력을 줄 단위로 받으면, 대답의 표준 출력을 줄로 나눠 돌려주기 전에 넘긴다.
 */
export class FakeProcessRunner implements ProcessRunner {
  /** 받은 요청. 받은 순서대로 쌓인다. */
  readonly requests: ProcessRequest[] = [];
  /** 대답 규칙. 뒤에 더한 것부터 본다. */
  private readonly rules: FakeProcessRule[] = [];

  /** `command`를 `args`로 부른 요청에 `reply`로 대답한다. */
  respond(command: string, args: readonly string[], reply: FakeProcessReply): void {
    this.respondWhen((request) => request.command === command && sameArgs(request.args, args), reply);
  }

  /** `matches`가 참인 요청에 `reply`로 대답한다. */
  respondWhen(matches: (request: ProcessRequest) => boolean, reply: FakeProcessReply): void {
    this.rules.unshift({ matches, reply });
  }

  async run(request: ProcessRequest): Promise<ProcessResult> {
    this.requests.push(request);
    /** 이 요청을 맡을 규칙. */
    const rule = this.rules.find((candidate) => candidate.matches(request));
    if (!rule) return { kind: 'spawn-failed', message: `spawn ${request.command} ENOENT` };
    /** 돌려줄 결과. */
    const result = typeof rule.reply === 'function' ? await rule.reply(request) : rule.reply;
    if (request.onStdoutLine && result.kind !== 'spawn-failed') {
      // 실제 실행기처럼 줄 끝의 \r을 떼고, 줄바꿈 뒤의 빈 칸은 넘기지 않는다.
      /** 표준 출력의 줄. */
      const lines = result.stdout.split('\n').map((line) => line.replace(/\r$/, ''));
      if (lines.at(-1) === '') lines.pop();
      for (const line of lines) request.onStdoutLine(line);
    }
    return result;
  }
}

/** 정상 종료 결과를 만든다. */
export function exited(exitCode: number, stdout = '', stderr = ''): ProcessResult {
  return { kind: 'exited', exitCode, stdout, stderr };
}

/** 두 인수 목록이 같은지 본다. */
function sameArgs(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
