import {
  SETUP_REQUIREMENTS,
  type AppSnapshot,
  type DetectionStartSnapshot,
  type SettingsSection,
  type SetupRequirement,
  type SetupRequirementStatus,
} from '../../shared/ipc';
import {
  DETECTION_START_FAILURE_MESSAGES,
  DETECTION_TARGET_LABEL,
  detectionStartHints,
  NO_DETECTION_TARGET_NOTICE,
  SETUP_BAND_TEXT,
  SETUP_GROUP_LABELS,
  SETUP_REQUIREMENT_LABELS,
  SETUP_REQUIREMENT_SECTIONS,
  windowsTrayHint,
} from '../../shared/onboarding-text';
import { AGENT_INFO } from '../../shared/agent-info';

/** 필수 설정 줄 오른쪽에 보일 상태 글자와 색. */
const STATUS_TEXT: Record<SetupRequirementStatus, { label: string; className: string }> = {
  done: { label: '✓', className: 'ok-text' },
  needed: { label: '필요', className: 'warning-text' },
  checking: { label: '확인 중', className: 'muted' },
};

/** 온보딩 화면에 넘기는 값. */
interface OnboardingProps {
  /** 앱 상태 스냅숏. */
  snapshot: AppSnapshot;
}

/** [감지 시작]을 보낸다. 시작하면 main이 설정 창을 닫고 빈 작은 창을 띄운다. */
function sendStartDetection(): void {
  void window.stardraft.send({ type: 'start-detection' });
}

/** 설정 창의 칸을 연다. 작은 창은 main이 닫는다. */
function sendOpenSettings(section?: SettingsSection): void {
  void window.stardraft.send(section ? { type: 'open-settings', section } : { type: 'open-settings' });
}

/**
 * 작은 창의 체크리스트. "필수" 묶음(에이전트 연결)과 "감지할 대상 · 선택" 묶음(Flow 계정)으로 나눈다.
 * 필수를 마치면 [감지 시작]을 보이고, 연결한 서비스가 없으면 그 위에 안내를 보인다. 막지는 않는다.
 */
export function SetupChecklist({ snapshot }: OnboardingProps) {
  /** 온보딩 상태. */
  const { requirements, ready, start, hasDetectionTarget } = snapshot.onboarding;
  /** Flow 계정 줄의 설명. 연결했으면 계정 이름과 소속이다. */
  const account = snapshot.flowAccount.account;

  return (
    <main className="popover-body">
      {!ready && <p className="setup-lead">감지를 시작하려면 에이전트를 연결해야 합니다.</p>}
      <h3 className="setup-group-title">{SETUP_GROUP_LABELS.required}</h3>
      {SETUP_REQUIREMENTS.map((requirement) => {
        /** 이 줄의 상태 글자. */
        const status = STATUS_TEXT[requirements[requirement]];
        return (
          <button
            key={requirement}
            type="button"
            className="setup-row"
            onClick={() => sendOpenSettings(SETUP_REQUIREMENT_SECTIONS[requirement])}
          >
            <span className="setup-row-text">
              <span className="setup-row-title">{SETUP_REQUIREMENT_LABELS[requirement]}</span>
              <span className="setup-row-detail">{requirementDetail(requirement, snapshot)}</span>
            </span>
            <span className={`setup-row-status ${status.className}`}>{status.label}</span>
            <span className="setup-row-go muted" aria-hidden="true">
              ›
            </span>
          </button>
        );
      })}
      <h3 className="setup-group-title">{SETUP_GROUP_LABELS.targets}</h3>
      <button type="button" className="setup-row" onClick={() => sendOpenSettings('flow-account')}>
        <span className="setup-row-text">
          <span className="setup-row-title">{DETECTION_TARGET_LABEL}</span>
          {hasDetectionTarget && account && <span className="setup-row-detail">{account.division ? `${account.name} · ${account.division}` : account.name}</span>}
        </span>
        <span className={`setup-row-status ${hasDetectionTarget ? 'ok-text' : 'muted'}`}>{hasDetectionTarget ? '✓' : '연결 안 함'}</span>
        <span className="setup-row-go muted" aria-hidden="true">
          ›
        </span>
      </button>
      {ready && !hasDetectionTarget && <p className="setup-notice small muted">{NO_DETECTION_TARGET_NOTICE}</p>}
      {ready && (
        <div className="setup-actions">
          <StartDetectionButton start={start} />
        </div>
      )}
      {start.status === 'failed' && (
        <p className="setup-error small danger-text" role="alert">
          {DETECTION_START_FAILURE_MESSAGES[start.reason]}
        </p>
      )}
    </main>
  );
}

/** Windows 작은 창의 숨김 영역 안내. 새 트레이 아이콘은 숨김 영역에 들어가므로 필수 설정 전과 감지 시작 직후의 빈 화면에 둔다. */
export function WindowsTrayHint({ snapshot }: OnboardingProps) {
  if (snapshot.platform !== 'win32') return null;
  return <p className="setup-tray-hint small muted">{windowsTrayHint(snapshot.appName)}</p>;
}

/** 설정 창 첫 설정 띠에 넘기는 값. */
interface SetupBandProps extends OnboardingProps {
  /** 지금 보이는 칸. 다음 항목 버튼은 이 칸이 아닌 남은 항목을 가리킨다. */
  section: SettingsSection;
  /** 칸을 바꾼다. */
  onSelectSection: (section: SettingsSection) => void;
}

/**
 * 설정 창 맨 위 첫 설정 띠. 진행 막대 없이 "필수 설정: 에이전트 연결"과 [에이전트 설정]을 보인다.
 * 필수를 마치면 [감지 시작]과 안내를 보이고, 연결한 서비스가 없으면 [감지 시작] 위에 안내를 더한다. 감지를 시작한 뒤에는 그리지 않는다.
 */
export function SetupBand({ snapshot, section, onSelectSection }: SetupBandProps) {
  /** 온보딩 상태. */
  const { detectionStarted, requirements, ready, start } = snapshot.onboarding;
  if (detectionStarted) return null;

  /** 끝나지 않은 필수 항목. */
  const remaining = SETUP_REQUIREMENTS.filter((requirement) => requirements[requirement] !== 'done');
  /** 다음 항목. 지금 보는 칸이 아닌 첫 남은 항목이다. */
  const next = remaining.find((requirement) => SETUP_REQUIREMENT_SECTIONS[requirement] !== section);

  return (
    <div className="setup-band-stack">
      {!ready && (
        <div className="setup-band">
          <strong>{SETUP_BAND_TEXT}</strong>
          <span className="setup-band-space" />
          {next && (
            <button type="button" className="btn sm" onClick={() => onSelectSection(SETUP_REQUIREMENT_SECTIONS[next])}>
              {SETUP_REQUIREMENT_LABELS[next]} 설정
            </button>
          )}
        </div>
      )}
      {/* 완료 안내의 줄바꿈 높이를 미리 확보하되, 완료 전에는 읽거나 조작할 수 없게 한다. */}
      <div className={`setup-band ready${ready ? '' : ' setup-band-reserve'}`} aria-hidden={!ready || undefined} inert={!ready}>
        <div className="setup-band-space">
          <strong>필수 설정을 마쳤습니다.</strong>
          {!snapshot.onboarding.hasDetectionTarget && <p className="setup-notice small">{NO_DETECTION_TARGET_NOTICE}</p>}
          <DetectionStartNotes snapshot={snapshot} />
        </div>
        <StartDetectionButton start={start} />
      </div>
    </div>
  );
}

/** 설정 창 칸 목록에서 끝나지 않은 필수 칸인지 본다. 감지를 시작한 뒤에는 점을 찍지 않는다. */
export function sectionNeedsSetup(snapshot: AppSnapshot, section: SettingsSection): boolean {
  if (snapshot.onboarding.detectionStarted) return false;
  return SETUP_REQUIREMENTS.some(
    (requirement) => SETUP_REQUIREMENT_SECTIONS[requirement] === section && snapshot.onboarding.requirements[requirement] !== 'done',
  );
}

/** [감지 시작] 버튼에 넘기는 값. */
interface StartDetectionButtonProps {
  /** [감지 시작]의 진행 상태. */
  start: DetectionStartSnapshot;
}

/** [감지 시작] 버튼. 시작하는 동안은 누를 수 없다. */
function StartDetectionButton({ start }: StartDetectionButtonProps) {
  return (
    <button type="button" className="btn primary" disabled={start.status === 'starting'} onClick={sendStartDetection}>
      {start.status === 'starting' ? '시작하는 중…' : '감지 시작'}
    </button>
  );
}

/** [감지 시작] 곁의 안내 두 줄과, 시작이 실패했으면 그 이유. */
function DetectionStartNotes({ snapshot }: OnboardingProps) {
  /** [감지 시작]의 진행 상태. */
  const { start } = snapshot.onboarding;
  return (
    <>
      {start.status === 'failed' && (
        <p className="setup-error small danger-text" role="alert">
          {DETECTION_START_FAILURE_MESSAGES[start.reason]}
        </p>
      )}
      <ul className="setup-hints small">
        {detectionStartHints(snapshot.platform, snapshot.appName).map((hint) => (
          <li key={hint}>{hint}</li>
        ))}
      </ul>
    </>
  );
}

/** 필수 설정 줄 아래에 보일 설명. 끝난 항목은 무엇이 연결됐는지, 남은 항목은 할 일을 적는다. */
function requirementDetail(requirement: SetupRequirement, snapshot: AppSnapshot): string {
  /** 이 항목의 상태. */
  const status = snapshot.onboarding.requirements[requirement];
  switch (requirement) {
    case 'agent':
      if (status === 'done') return `${snapshot.agentPreferences.connectedAgents.map((agent) => AGENT_INFO[agent].name).join(' · ')} 연결됨`;
      if (status === 'checking') return '연결을 확인하는 중입니다';
      return '연결하지 못했습니다. 눌러서 원인을 확인합니다';
  }
}
