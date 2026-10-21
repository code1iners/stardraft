/**
 * 가짜 Claude Code stream-json 이벤트. 실제 CLI(2.1.303)의 출력 모양에서 앱이 읽는 필드만 남겼다.
 * 한 줄에 이벤트 하나이고, 마지막 줄이 `result` 메시지다.
 */
export const fakeClaudeEvent = {
  /** 첫 이벤트. CLI 버전과 이 실행의 모델을 알려 준다. */
  init(version = '2.1.303', model = 'claude-fake-model'): string {
    return JSON.stringify({ type: 'system', subtype: 'init', claude_code_version: version, model, tools: ['Glob', 'Grep', 'Read', 'StructuredOutput'] });
  },

  /** 파일을 읽으려고 도구를 부른 assistant 이벤트. `id`는 도구 결과와 짝을 맞출 도구 호출 ID다. */
  toolUse(filePath = '/fake/work/repo-a/RetryConfig.kt', id = 'toolu_fake_read'): string {
    return fakeClaudeEvent.tools({ id, name: 'Read', input: { file_path: filePath } });
  },

  /** 도구를 부른 assistant 이벤트. 한 메시지에 도구 여럿을 함께 부를 수 있다. ID를 주지 않으면 메시지 안 순서로 매긴다. */
  tools(...uses: { id?: string; name: string; input: Record<string, unknown> }[]): string {
    return JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: uses.map(({ id, name, input }, index) => ({ type: 'tool_use', id: id ?? `toolu_fake_${index}`, name, input })),
      },
    });
  },

  /** 도구를 실행한 결과를 모델에 돌려준 user 이벤트. 비밀 파일처럼 거부된 읽기는 `isError`가 참이다. */
  toolResult(toolUseId: string, { isError = false, content = '가짜 도구 결과' }: { isError?: boolean; content?: string } = {}): string {
    return JSON.stringify({
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content, is_error: isError }] },
    });
  },

  /** 모델 API 오류를 알린 assistant 이벤트. 실제 CLI는 `error`에 오류 종류를 담는다. */
  apiError(error: string, text: string): string {
    return JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] }, error, is_api_error_message: true });
  },

  /** 마지막 `result` 메시지. 기본값은 오류 없는 성공이다. */
  result(fields: Record<string, unknown>): string {
    return JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 2, result: '', total_cost_usd: 0.01, ...fields });
  },
};

/** 이벤트를 줄로 이은 표준 출력. */
export function claudeStream(...events: string[]): string {
  return `${events.join('\n')}\n`;
}

/** 구조화 출력 `output`으로 성공한 실행의 표준 출력. */
export function claudeSuccessStream(output: Record<string, unknown>, version = '2.1.303'): string {
  return claudeStream(fakeClaudeEvent.init(version), fakeClaudeEvent.result({ structured_output: output }));
}

/** 로그인되어 있지 않을 때의 표준 출력(실측: 종료 코드 1). */
export function claudeNotLoggedInStream(): string {
  /** 실제 CLI의 문구. */
  const text = 'Not logged in · Please run /login';
  return claudeStream(
    fakeClaudeEvent.init(),
    fakeClaudeEvent.apiError('authentication_failed', text),
    fakeClaudeEvent.result({ is_error: true, terminal_reason: 'api_error', api_error_status: null, result: text }),
  );
}
