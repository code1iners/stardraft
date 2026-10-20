/** 앱이 아는 것보다 새 형식의 데이터를 만났을 때 보이는 안내. 버전을 모르면 버전 없이 쓴다. */
export function newerDataMessage(createdByVersion: string | null): string {
  /** 안내에 넣을 버전 표기. */
  const version = createdByVersion ? `(v${createdByVersion})` : '';
  return `이 데이터는 더 새 버전${version}에서 만들어졌습니다. 새 버전을 다시 설치하세요.`;
}

/** 앱이 아는 것보다 새 형식의 `settings.json`이나 `state.db`를 만났다. 데이터는 건드리지 않는다. */
export class NewerDataError extends Error {
  override readonly name = 'NewerDataError';

  /** @param createdByVersion 데이터를 쓴 앱 버전. 모르면 `null`. */
  constructor(readonly createdByVersion: string | null) {
    super(newerDataMessage(createdByVersion));
  }
}
