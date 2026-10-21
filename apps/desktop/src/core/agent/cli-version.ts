/**
 * `--version` 출력에서 버전을 꺼낸다. Claude Code는 `2.1.303 (Claude Code)`, Codex는 `codex-cli 0.163.0`처럼 낸다. 없으면 `null`.
 */
export function parseCliVersion(output: string): string | null {
  return /\b(\d+)\.(\d+)\.(\d+)\b/.exec(output)?.[0] ?? null;
}

/** 두 `x.y.z` 버전을 비교한다. `a`가 낮으면 음수, 같으면 0, 높으면 양수. */
export function compareVersions(a: string, b: string): number {
  /** 숫자로 나눈 두 버전. */
  const [left, right] = [a, b].map((version) => version.split('.').map(Number));
  for (let index = 0; index < 3; index += 1) {
    /** 이 자리의 차이. */
    const diff = (left?.[index] ?? 0) - (right?.[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
