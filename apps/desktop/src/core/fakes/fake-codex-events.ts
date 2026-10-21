/**
 * 가짜 Codex `exec --json` JSONL 이벤트. 실제 CLI(0.163.0)를 모의 모델로 돌린 출력 모양에서 앱이 읽는 필드만 남겼다.
 * 한 줄에 이벤트 하나다. 연결 확인이 읽는 `codex login status`·`codex debug models` 출력도 이 파일에 둔다.
 */
export const fakeCodexEvent = {
  /** 첫 이벤트. */
  threadStarted(): string {
    return JSON.stringify({ type: 'thread.started', thread_id: '00000000-0000-7000-8000-000000000000' });
  },

  /** 턴을 시작했다. */
  turnStarted(): string {
    return JSON.stringify({ type: 'turn.started' });
  },

  /** 명령을 띄웠다. 실제 CLI는 명령을 로그인 셸(`/bin/zsh -lc '…'`)로 감싸 알린다. */
  commandStarted(id: string, script: string): string {
    return JSON.stringify({
      type: 'item.started',
      item: { id, type: 'command_execution', command: wrapped(script), aggregated_output: '', exit_code: null, status: 'in_progress' },
    });
  },

  /** 명령이 끝났다. 종료 코드가 0이 아니면 `failed`다. 샌드박스가 막은 명령은 실제 CLI가 이벤트를 내지 않는다. */
  commandCompleted(id: string, script: string, { exitCode = 0, output = '가짜 명령 출력\n' }: { exitCode?: number; output?: string } = {}): string {
    return JSON.stringify({
      type: 'item.completed',
      item: {
        id,
        type: 'command_execution',
        command: wrapped(script),
        aggregated_output: output,
        exit_code: exitCode,
        status: exitCode === 0 ? 'completed' : 'failed',
      },
    });
  },

  /** 턴을 끝내지 않는 오류 항목. 모의 모델을 쓸 때의 경고 같은 것이다. */
  errorItem(id: string, message: string): string {
    return JSON.stringify({ type: 'item.completed', item: { id, type: 'error', message } });
  },

  /** 에이전트의 마지막 메시지. `--output-schema`를 주면 스키마에 맞는 JSON 문자열이다. */
  agentMessage(id: string, text: string): string {
    return JSON.stringify({ type: 'item.completed', item: { id, type: 'agent_message', text } });
  },

  /** 턴이 끝났다. 토큰 수를 알려 준다. `input_tokens`는 캐시에서 읽은 토큰을 포함한다. */
  turnCompleted(usage: { input?: number; cached?: number; output?: number } = {}): string {
    return JSON.stringify({
      type: 'turn.completed',
      usage: {
        input_tokens: usage.input ?? 400,
        cached_input_tokens: usage.cached ?? 160,
        cache_write_input_tokens: 0,
        output_tokens: usage.output ?? 28,
        reasoning_output_tokens: 0,
      },
    });
  },

  /** 다시 시도할 오류나 끝내기 직전의 오류를 알렸다. 턴을 끝내는 것은 `turn.failed`다. */
  error(message: string): string {
    return JSON.stringify({ type: 'error', message });
  },

  /** 턴이 실패했다. */
  turnFailed(message: string): string {
    return JSON.stringify({ type: 'turn.failed', error: { message } });
  },
};

/** 실제 CLI처럼 명령을 로그인 셸로 감싼다. 작은따옴표는 셸 규칙대로 닫고 이스케이프해 다시 연다. */
function wrapped(script: string): string {
  return `/bin/zsh -lc '${script.replaceAll("'", `'\\''`)}'`;
}

/** 이벤트를 줄로 이은 표준 출력. */
export function codexStream(...events: string[]): string {
  return `${events.join('\n')}\n`;
}

/** 구조화 출력 `output`으로 성공한 실행의 표준 출력. */
export function codexSuccessStream(output: Record<string, unknown>): string {
  return codexStream(
    fakeCodexEvent.threadStarted(),
    fakeCodexEvent.turnStarted(),
    fakeCodexEvent.agentMessage('item_0', JSON.stringify(output)),
    fakeCodexEvent.turnCompleted(),
  );
}

/** 로그인되어 있지 않은 실행의 표준 출력(실측: 종료 코드 1). 다시 연결을 몇 번 시도한 뒤 턴이 실패한다. */
export function codexNotLoggedInStream(): string {
  /** 실제 CLI의 문구. 요청 ID 같은 값은 가짜다. */
  const message = 'unexpected status 401 Unauthorized: Missing bearer or basic authentication in header, url: https://api.openai.com/v1/responses';
  return codexStream(
    fakeCodexEvent.threadStarted(),
    fakeCodexEvent.turnStarted(),
    fakeCodexEvent.error(`Reconnecting... 1/5 (${message})`),
    fakeCodexEvent.error(message),
    fakeCodexEvent.turnFailed(message),
  );
}

/** 가짜 `codex login status` 출력. 실제 CLI(0.163.0)는 표준 오류로 한 줄을 낸다. */
export const fakeCodexLoginStatus = {
  /** ChatGPT 계정으로 로그인되어 있다(종료 코드 0). */
  chatgpt: 'Logged in using ChatGPT\n',
  /** API 키로 로그인되어 있다(종료 코드 0). 키 끝자리는 가짜다. */
  apiKey: 'Logged in using an API key - sk-fake***abcd\n',
  /** 로그인되어 있지 않다(종료 코드 1). */
  notLoggedIn: 'Not logged in\n',
};

/** 가짜 `codex debug models` 출력. 실제 CLI(0.163.0)는 `{"models":[…]}` 한 줄을 내고, 항목마다 앱이 읽지 않는 필드가 많다. */
export function codexModelsOutput(models: { slug: string; display_name: string; visibility: string; priority?: number }[]): string {
  return `${JSON.stringify({ models: models.map((model) => ({ base_instructions: '가짜 기본 지침', supported_in_api: true, ...model })) })}\n`;
}
