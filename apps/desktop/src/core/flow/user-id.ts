/**
 * 두 Flow 사용자 ID가 같은 사람인지 본다.
 * 사용자 ID는 이메일 형식이라 대소문자와 앞뒤 공백을 가리지 않는다. 같은 사람을 다른 계정으로 잘못 보면 기록을 지우게 된다.
 */
export function isSameFlowUser(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
