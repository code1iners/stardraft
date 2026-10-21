import type { ReviewSection, ReviewSnapshot, ReviewWindow } from '../shared/ipc';

/**
 * 창마다 영역의 처음 펼침 상태. 작은 창은 원문 → 요구 → 초안과 진행을 펴고 근거와 저장소를 접어 두며, 펼친 창은 모두 편다.
 */
const INITIAL_SECTIONS: ReviewSnapshot['sections'] = {
  compact: { original: true, requirement: true, draft: true, evidence: false, repository: false, progress: true },
  expanded: { original: true, requirement: true, draft: true, evidence: true, repository: true, progress: true },
};

/**
 * 작은 창과 펼친 창의 영역 펼침 상태. 창마다 따로 기억하고, 다른 묶음으로 넘어가도 유지한다.
 * 창은 닫을 때 없애므로 상태는 main에 두며, 앱이 켜져 있는 동안만 기억한다.
 */
export class ReviewSections {
  /** 창마다 영역의 펼침 상태. */
  private sections: ReviewSnapshot['sections'] = structuredClone(INITIAL_SECTIONS);
  /** 펼침 상태가 바뀔 때 부를 함수. */
  private readonly listeners = new Set<() => void>();

  /** 창마다 영역의 펼침 상태. */
  state(): ReviewSnapshot['sections'] {
    return structuredClone(this.sections);
  }

  /** 창의 영역을 접거나 편다. 바뀌었으면 듣는 쪽에 알린다. */
  set(window: ReviewWindow, section: ReviewSection, open: boolean): void {
    if (this.sections[window][section] === open) return;
    this.sections[window][section] = open;
    for (const listener of this.listeners) listener();
  }

  /** 펼침 상태가 바뀔 때마다 `listener`를 부른다. 돌려준 함수를 부르면 그만 부른다. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
