import type { KeyboardEvent } from 'react';
import type {
  ManualCheckLoadFailureSnapshot,
  ManualCheckMissReasonSnapshot,
  ManualCheckRowSnapshot,
  ManualCheckSheetSnapshot,
  ManualCheckSnapshot,
  ManualCheckTabSnapshot,
  ManualCheckWindowSnapshot,
} from '../../shared/ipc';
import { BUNDLE_STATUS_TAGS, formatTime } from './review-text';

/** 탭마다 목록을 가리키는 말(목적격). */
const TAB_OBJECTS: Record<ManualCheckTabSnapshot, string> = { mentions: '최근 멘션을', assignments: '담당 업무를' };

/** 탭 이름. */
const TAB_LABELS: Record<ManualCheckTabSnapshot, string> = { mentions: '멘션', assignments: '담당 업무' };

/** 탭 순서. 멘션이 먼저다. */
const TABS: readonly ManualCheckTabSnapshot[] = ['mentions', 'assignments'];

/** 목록을 불러오지 못한 까닭의 쉬운 말. `object`는 불러오던 목록(목적격)이다. */
function loadFailureText(reason: ManualCheckLoadFailureSnapshot, object: string): string {
  switch (reason) {
    case 'no-key':
      return `Flow 개인 API 키가 없어 ${object} 불러오지 못했습니다.`;
    case 'unauthorized':
      return `Flow가 키를 받지 않아 ${object} 불러오지 못했습니다. 설정 "Flow 계정"에서 키를 확인하세요.`;
    case 'network':
      return 'Flow에 연결하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 불러오세요.';
    case 'rate-limited':
      return 'Flow 요청이 많습니다. 잠시 뒤에 다시 불러오세요.';
    case 'unexpected':
      return `${object} 불러오지 못했습니다.`;
  }
}

/** 감지에서 빠진 이유의 태그 글자. */
const MISS_REASON_LABELS: Record<ManualCheckMissReasonSnapshot, string> = {
  'pre-feature-task': '기능 시작 전 업무',
  'pre-feature-assignment': '기능 시작 전 배정',
  'self-authored': '자기 작성 업무',
  'no-evidence': '배정 근거 없음',
};

/** 시트 안내 문구. 고르기 전에는 Flow에 아무것도 올라가지 않는다. */
export const MANUAL_CHECK_NOTE = '고른 항목으로 초안을 만듭니다. 게시 전에는 Flow에 아무것도 올라가지 않습니다.';

/** 담당 업무 탭의 안내 문구. 목록이 알림에서만 나오는 한계를 알린다. */
export const ASSIGNMENT_TAB_NOTE = '담당 업무는 알림이 온 업무만 나옵니다. 알림이 오기 전에 배정된 업무나 알림이 없는 업무는 목록에 없습니다.';

/** 감지를 시작하기 전이나 키를 쓸 수 없을 때 버튼이 꺼진 까닭. */
export const MANUAL_CHECK_DISABLED_TEXT = '멘션 감지를 시작하고 Flow 키를 쓸 수 있을 때 열 수 있습니다.';

/** [최근 멘션 확인] 버튼에 넘기는 값. */
interface ManualCheckButtonProps {
  /** 최근 멘션 확인 상태. */
  manualCheck: ManualCheckSnapshot;
  /** 확인 시트를 열 창. */
  window: ManualCheckWindowSnapshot;
}

/** [최근 멘션 확인]. 감지를 시작했고 쓸 수 있는 Flow 키가 있을 때만 누를 수 있다. 누르면 이 창에 확인 시트를 연다. */
export function ManualCheckButton({ manualCheck, window: checkWindow }: ManualCheckButtonProps) {
  /** 확인 시트를 연다. */
  const handleOpen = () => {
    void window.stardraft.send({ type: 'open-manual-check', window: checkWindow });
  };

  return (
    <button type="button" className="btn" disabled={!manualCheck.canOpen} title={manualCheck.canOpen ? undefined : MANUAL_CHECK_DISABLED_TEXT} onClick={handleOpen}>
      최근 멘션 확인
    </button>
  );
}

/** 확인 시트에 넘기는 값. */
interface ManualCheckSheetProps {
  /** 열린 시트. */
  sheet: ManualCheckSheetSnapshot;
}

/**
 * 확인 시트("확인할 항목 고르기"). "멘션 | 담당 업무" 탭으로 나눠 최근 항목을 보낸 사람, Flow 프로젝트, 첫 줄(업무는 제목), 시각과 상태 태그로 보이고,
 * 하나를 고르면 수동 요청 묶음을 만든다. 담당 업무 줄에는 감지에서 빠진 이유 태그가 붙는다. 이미 묶음이 있는 줄을 고르면 그 묶음으로 이동한다. 자동으로 고르지 않는다.
 */
export function ManualCheckSheet({ sheet }: ManualCheckSheetProps) {
  /** 시트를 닫는다. */
  const handleClose = () => {
    void window.stardraft.send({ type: 'close-manual-check' });
  };

  /** Esc는 [닫기]와 같다. */
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') handleClose();
  };

  /** 목록을 처음부터 다시 불러온다. */
  const handleReload = () => {
    void window.stardraft.send({ type: 'reload-manual-check' });
  };

  /** 10건을 더 불러온다. */
  const handleMore = () => {
    void window.stardraft.send({ type: 'load-more-manual-check' });
  };

  /** 탭을 바꾼다. */
  const handleTab = (tab: ManualCheckTabSnapshot) => {
    if (tab !== sheet.tab) void window.stardraft.send({ type: 'select-manual-check-tab', tab });
  };

  /** 지금 탭의 목록을 가리키는 말. */
  const object = TAB_OBJECTS[sheet.tab];

  return (
    <div className="sheet-backdrop">
      <div className="sheet manual-check" role="dialog" aria-modal="true" aria-labelledby="manual-check-title" onKeyDown={handleKeyDown}>
        <h3 id="manual-check-title">확인할 항목 고르기</h3>
        <div className="manual-check-tabs" role="tablist" aria-label="확인할 항목 종류">
          {TABS.map((tab) => (
            <button key={tab} type="button" role="tab" id={`manual-check-tab-${tab}`} aria-selected={tab === sheet.tab} className={tab === sheet.tab ? 'on' : undefined} onClick={() => handleTab(tab)}>
              {TAB_LABELS[tab]}
            </button>
          ))}
        </div>
        <p className="muted small">{MANUAL_CHECK_NOTE}</p>
        {sheet.tab === 'assignments' && <p className="muted small">{ASSIGNMENT_TAB_NOTE}</p>}
        {sheet.status === 'loading' && <p className="muted">{object} 불러오는 중입니다.</p>}
        {sheet.status === 'failed' && <p className="field-error">{loadFailureText(sheet.reason, object)}</p>}
        {sheet.status === 'loaded' &&
          (sheet.rows.length > 0 ? (
            <ul className="manual-check-choices" role="tabpanel" aria-labelledby={`manual-check-tab-${sheet.tab}`}>
              {sheet.rows.map((row) => (
                <ManualCheckChoice key={row.alarmId} row={row} />
              ))}
            </ul>
          ) : (
            <p className="muted">{sheet.tab === 'mentions' ? '확인할 수 있는 최근 멘션이 없습니다.' : '고를 수 있는 담당 업무가 없습니다.'}</p>
          ))}
        {sheet.status === 'loaded' && sheet.moreFailure && <p className="field-error">{loadFailureText(sheet.moreFailure, object)}</p>}
        {sheet.status === 'loaded' && sheet.loadingMore && <p className="muted">더 불러오는 중입니다.</p>}
        {sheet.status === 'loaded' && !sheet.hasMore && sheet.rows.length > 0 && <p className="muted small">더 이상 없음</p>}
        <div className="sheet-actions">
          {sheet.status === 'loaded' && sheet.hasMore && (
            <button type="button" className="btn" disabled={sheet.loadingMore} onClick={handleMore}>
              더 보기
            </button>
          )}
          {sheet.status !== 'loading' && (
            <button type="button" className="btn" onClick={handleReload}>
              다시 불러오기
            </button>
          )}
          <button type="button" className="btn" onClick={handleClose}>
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}

/** 확인 시트의 한 줄에 넘기는 값. */
interface ManualCheckChoiceProps {
  /** 보일 줄. */
  row: ManualCheckRowSnapshot;
}

/** 확인 시트의 한 줄. 누르면 그 항목으로 수동 요청 묶음을 만들거나, 이미 있는 묶음을 연다. */
function ManualCheckChoice({ row }: ManualCheckChoiceProps) {
  /** 이 항목을 고른다. main이 시트를 닫는다. */
  const handlePick = () => {
    void window.stardraft.send({ type: 'pick-manual-check', alarmId: row.alarmId });
  };

  return (
    <li>
      <button type="button" className="manual-check-choice" onClick={handlePick}>
        <span className="list-row-top">
          <strong>{row.senderName || '이름 없음'}</strong>
          {row.missReasons.map((reason) => (
            <span key={reason} className="tag warn">
              {MISS_REASON_LABELS[reason]}
            </span>
          ))}
          {row.tags.map((tag) =>
            tag.kind === 'answered' ? (
              <span key="answered" className="tag done">
                답함
              </span>
            ) : tag.kind === 'archived' ? (
              <span key="archived" className="tag done">
                처리됨
              </span>
            ) : (
              <span key="bundle" className="list-row-tags">
                <span className="tag done">이미 묶음 있음</span>
                <span className={`tag ${BUNDLE_STATUS_TAGS[tag.status].className}`}>{BUNDLE_STATUS_TAGS[tag.status].label}</span>
              </span>
            ),
          )}
          <span className="spacer" />
          <span className="small muted">{formatTime(row.at)}</span>
        </span>
        <span className="small muted">{row.projectTitle ?? 'Flow 프로젝트 이름 모름'}</span>
        <span className="list-row-sub">{row.firstLine}</span>
      </button>
    </li>
  );
}
