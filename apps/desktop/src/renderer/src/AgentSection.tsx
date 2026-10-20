import { useEffect, useRef, useState, type ReactNode } from 'react';
import { agentFixCommand } from '../../shared/agent-fix-command';
import type {
  AgentCheckDetails,
  AgentCheckFailure,
  AgentCheckProgress,
  AgentCheckStep,
  AgentConnectionSnapshot,
  AppSnapshot,
} from '../../shared/ipc';

/** 연결선의 네 마디. 화면에 이 순서로 보인다. */
const STEPS: readonly { step: AgentCheckStep; label: string }[] = [
  { step: 'find', label: '찾기' },
  { step: 'version', label: '버전' },
  { step: 'login', label: '로그인' },
  { step: 'run-check', label: '작동 확인' },
];

/** 실패 카드 셋째 장의 그림. */
type ThirdPicture = 'done' | 'browser';

/** 실패 이유별 문구. */
interface FailureText {
  /** 끊긴 마디 아래에 적는 짧은 원인. */
  cause: string;
  /** 연결선 아래 한 줄. */
  title: string;
  /** 명령으로 고칠 수 없는 실패의 한 줄 안내. 명령 카드가 있으면 보이지 않는다. */
  line: string;
  /** 셋째 카드(원인별 다음 행동)의 설명과 그림. 명령으로 고치는 실패에만 있다. */
  third?: { label: string; picture: ThirdPicture };
}

/** 실패 이유별 문구. 경로·버전·로그인 방식·오류 원문은 넣지 않고 "자세히"에만 둔다. */
const FAILURE_TEXT: Record<AgentCheckFailure['reason'], FailureText> = {
  'not-found': {
    cause: '설치 필요',
    title: 'Claude Code를 찾지 못했습니다',
    line: '설치한 뒤 다시 확인을 누르세요. 이미 설치했다면 위치를 직접 지정할 수 있습니다.',
    third: { label: '설치가 끝났다는 줄이 나올 때까지 기다리기', picture: 'done' },
  },
  'picked-invalid': {
    cause: '실행할 수 없음',
    title: '고른 파일을 실행할 수 없습니다',
    line: 'Claude Code CLI 실행 파일(claude)을 다시 지정하거나 다시 찾기를 눌러 주세요.',
  },
  'update-required': {
    cause: '업데이트 필요',
    title: 'Claude Code를 업데이트해야 합니다',
    line: '업데이트한 뒤 다시 확인을 누르세요.',
    third: { label: '업데이트가 끝났다는 줄이 나올 때까지 기다리기', picture: 'done' },
  },
  unreadable: {
    cause: '확인 실패',
    title: 'Claude Code에서 답을 읽지 못했습니다',
    line: '다시 확인을 눌러 주세요. 계속 실패하면 자세히에서 오류 내용을 확인해 주세요.',
  },
  'not-logged-in': {
    cause: '로그인 필요',
    title: 'Claude Code에 로그인해야 합니다',
    line: '로그인한 뒤 다시 확인을 누르세요.',
    third: { label: '열린 브라우저에서 로그인', picture: 'browser' },
  },
  'api-key-helper': {
    cause: '로그인 방식 바꾸기',
    title: 'apiKeyHelper 로그인은 지원하지 않습니다. Claude 계정으로 로그인해 주세요',
    line: 'Claude 계정으로 로그인한 뒤 다시 확인을 누르세요.',
    third: { label: '열린 브라우저에서 Claude 계정으로 로그인', picture: 'browser' },
  },
};

/** 마디 하나의 상태. `ok`는 끝남, `cur`는 진행 중, `bad`는 끊김, 빈 문자열은 남은 단계다. */
type SegmentState = 'ok' | 'cur' | 'bad' | '';

/** 지금 확인하거나 멈춘 단계. 아직 확인하지 않았으면 `null`. 셋째 단계까지 통과했으면 작동 확인이 남은 단계다. */
function currentStep(progress: AgentCheckProgress): AgentCheckStep | null {
  switch (progress.status) {
    case 'idle':
      return null;
    case 'checking':
      return progress.step;
    case 'failed':
      return progress.failure.step;
    case 'awaiting-run-check':
      return 'run-check';
  }
}

/** `index`번째 마디의 상태. */
function segmentState(progress: AgentCheckProgress, index: number): SegmentState {
  /** 지금 확인하거나 멈춘 마디의 위치. */
  const at = STEPS.findIndex((item) => item.step === currentStep(progress));
  if (at < 0 || index > at) return '';
  if (index < at) return 'ok';
  if (progress.status === 'checking') return 'cur';
  return progress.status === 'failed' ? 'bad' : '';
}

/** "에이전트" 칸에 넘기는 값. */
interface AgentSectionProps {
  /** Claude Code 연결 확인 상태. */
  agentConnection: AgentConnectionSnapshot;
  /** 실행 중인 OS. 터미널 이름과 명령을 고른다. */
  platform: AppSnapshot['platform'];
}

/**
 * 설정 "에이전트" 칸. 칸을 열면 Claude Code를 찾고 버전과 로그인을 차례로 확인해, Stardraft와 Claude Code를 잇는 연결선으로 보인다.
 * 실패하면 그 마디가 끊기고, 명령으로 고칠 수 있으면 그림 카드 네 장을 보인다.
 */
export function AgentSection({ agentConnection, platform }: AgentSectionProps) {
  /** 진행 상태와 "자세히" 내용. */
  const { progress, details } = agentConnection;
  /** "자세히"를 펼쳤는지 여부. */
  const [showDetails, setShowDetails] = useState(false);

  useEffect(function checkAgentOnOpen() {
    // 칸을 열 때마다 확인한다. 이미 확인 중이면 main이 그 확인을 이어 간다.
    void window.stardraft.send({ type: 'check-agent' });
  }, []);

  /** 확인 중인지 여부. 확인 중에는 다시 확인·다시 찾기·직접 지정을 막는다. */
  const checking = progress.status === 'checking';
  /** 멈춘 이유. 실패가 아니면 `null`. */
  const failure = progress.status === 'failed' ? progress.failure : null;
  /** 실패 카드의 명령. 명령으로 고칠 수 없으면 `null`. */
  const fixCommand = failure && agentFixCommand(failure, details, platform);
  /** 찾기에서 멈췄는지 여부. 이때 "직접 지정"을 보인다. */
  const findFailed = failure?.step === 'find';

  /** 저장한 경로로 다시 확인한다. */
  const handleCheck = () => void window.stardraft.send({ type: 'check-agent' });
  /** 저장한 경로를 무시하고 다시 찾는다. */
  const handleRediscover = () => void window.stardraft.send({ type: 'rediscover-agent' });
  /** 파일 선택 창으로 CLI를 직접 지정한다. */
  const handlePick = () => void window.stardraft.send({ type: 'pick-agent-cli' });

  return (
    <>
      <p className="section-lead muted">초안을 만드는 데 쓰는 이 PC의 에이전트입니다.</p>
      <div className="agent-card">
        <div className="agent-link">
          <AgentNode label="Stardraft" accent>
            <svg width="20" height="20" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M2.5 2.75h11a.75.75 0 0 1 .75.75v7a.75.75 0 0 1-.75.75H8.2L4.75 14v-2.75H2.5a.75.75 0 0 1-.75-.75v-7a.75.75 0 0 1 .75-.75z"
                fill="currentColor"
              />
            </svg>
          </AgentNode>
          <ol className="agent-segments" aria-label="연결 단계">
            {STEPS.map(({ step, label }, index) => {
              /** 이 마디의 상태. */
              const state = segmentState(progress, index);
              return (
                <li key={step} className={`agent-segment ${state}`} aria-current={state === 'cur' ? 'step' : undefined}>
                  <span className="agent-bar">{state === 'bad' && <span className="agent-break" aria-hidden="true">✕</span>}</span>
                  {state === 'bad' && failure ? FAILURE_TEXT[failure.reason].cause : label}
                </li>
              );
            })}
          </ol>
          <AgentNode label="Claude Code">
            C
          </AgentNode>
        </div>

        <StatusLine progress={progress} />

        {failure &&
          (fixCommand && FAILURE_TEXT[failure.reason].third ? (
            <FixCards command={fixCommand} third={FAILURE_TEXT[failure.reason].third} platform={platform} onCheck={handleCheck} />
          ) : (
            <p className="agent-notice">{FAILURE_TEXT[failure.reason].line}</p>
          ))}

        <div className="agent-actions">
          {!fixCommand && (
            <button type="button" className="btn sm" onClick={handleCheck} disabled={checking}>
              다시 확인
            </button>
          )}
          <button type="button" className="btn sm" onClick={handleRediscover} disabled={checking}>
            다시 찾기
          </button>
          {findFailed && (
            <button type="button" className="btn sm" onClick={handlePick} disabled={checking}>
              직접 지정…
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn link small" aria-expanded={showDetails} onClick={() => setShowDetails((open) => !open)}>
            {showDetails ? '자세히 닫기' : '자세히'}
          </button>
        </div>

        {showDetails && <AgentDetails details={details} failure={failure} platform={platform} />}
      </div>
    </>
  );
}

/** 연결선 양 끝의 앱 아이콘에 넘기는 값. */
interface AgentNodeProps {
  /** 아이콘 아래 이름. */
  label: string;
  /** Stardraft 아이콘처럼 강조 색으로 그리는지 여부. */
  accent?: boolean;
  /** 아이콘 안에 그릴 것. */
  children: ReactNode;
}

/** 연결선 양 끝의 앱 아이콘과 이름. */
function AgentNode({ label, accent = false, children }: AgentNodeProps) {
  return (
    <div className="agent-node">
      <span className={`agent-mark${accent ? ' accent' : ''}`} aria-hidden="true">
        {children}
      </span>
      {label}
    </div>
  );
}

/** 연결선 아래 한 줄. 진행 중이면 단계, 실패하면 원인을 적는다. */
function StatusLine({ progress }: { progress: AgentCheckProgress }) {
  switch (progress.status) {
    case 'idle':
      return <p className="agent-status muted">확인 전</p>;
    case 'checking':
      return (
        <p className="agent-status muted" role="status">
          {STEPS.find((item) => item.step === progress.step)?.label} 확인 중…
        </p>
      );
    case 'failed':
      return (
        <p className="agent-status danger-text" role="alert">
          {FAILURE_TEXT[progress.failure.reason].title}
        </p>
      );
    case 'awaiting-run-check':
      return <p className="agent-status muted">찾기·버전·로그인을 확인했습니다. 작동 확인은 다음 단계입니다.</p>;
  }
}

/** 실패 카드에 넘기는 값. */
interface FixCardsProps {
  /** 붙여 넣을 명령. */
  command: string;
  /** 셋째 카드의 설명과 그림. */
  third: FailureText['third'];
  /** 실행 중인 OS. */
  platform: AppSnapshot['platform'];
  /** [다시 확인]을 눌렀을 때. */
  onCheck: () => void;
}

/** 명령을 복사했다고 보이는 시간(밀리초). */
const COPIED_NOTICE_MS = 2_000;

/** 명령으로 고치는 실패의 그림 카드 네 장: 터미널 열기, 명령 붙여 넣기, 원인별 다음 행동, 다시 확인. */
function FixCards({ command, third, platform, onCheck }: FixCardsProps) {
  /** 방금 명령을 복사했는지 여부. */
  const [copied, setCopied] = useState(false);
  /** "복사됨"을 지우는 타이머. */
  const copiedTimer = useRef<number | null>(null);
  /** Windows인지 여부. 터미널 이름과 프롬프트가 다르다. */
  const isWindows = platform === 'win32';

  useEffect(function clearCopiedTimerOnUnmount() {
    return () => {
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    };
  }, []);

  /** 명령을 클립보드에 넣는다. 명령은 main이 지금 상태에서 다시 정한다. */
  const handleCopy = () => {
    void window.stardraft.send({ type: 'copy-agent-fix-command' }).then(() => {
      setCopied(true);
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(false), COPIED_NOTICE_MS);
    });
  };

  return (
    <ol className="fix-cards">
      <li className="fix-card">
        <span className="fix-number">1</span>
        <div className="fix-picture">
          <span className="mini-app" aria-hidden="true">
            &gt;_
          </span>
        </div>
        <span className="fix-caption">{isWindows ? '시작 메뉴에서 "PowerShell" 열기' : 'Spotlight에서 "터미널" 열기'}</span>
      </li>
      <li className="fix-card">
        <span className="fix-number">2</span>
        <div className="fix-picture">
          <div className="mini-term">
            <span className="mini-prompt">{isWindows ? 'PS>' : '%'}</span> <span className="mini-command">{command}</span>
          </div>
        </div>
        <span className="fix-caption">명령을 붙여 넣고 Enter</span>
        <button type="button" className="btn sm fix-copy" onClick={handleCopy}>
          {copied ? '복사됨' : '명령 복사'}
        </button>
      </li>
      <li className="fix-card">
        <span className="fix-number">3</span>
        <div className="fix-picture" aria-hidden="true">
          {third?.picture === 'browser' ? (
            <div className="mini-browser">
              <div className="mini-browser-bar" />
              <div className="mini-browser-body">
                Claude에 로그인
                <br />
                <span className="mini-browser-go">승인</span>
              </div>
            </div>
          ) : (
            <div className="mini-term">
              <span className="mini-done">✓ 완료</span>
            </div>
          )}
        </div>
        <span className="fix-caption">{third?.label}</span>
      </li>
      <li className="fix-card">
        <span className="fix-number">4</span>
        <div className="fix-picture">
          <button type="button" className="btn primary" onClick={onCheck}>
            다시 확인
          </button>
        </div>
        <span className="fix-caption">돌아와서 다시 확인</span>
      </li>
    </ol>
  );
}

/** "자세히"에 넘기는 값. */
interface AgentDetailsProps {
  /** 확인 내용. */
  details: AgentCheckDetails;
  /** 멈춘 이유. 실패가 아니면 `null`. */
  failure: AgentCheckFailure | null;
  /** 실행 중인 OS. PATH 출처 문구를 고른다. */
  platform: AppSnapshot['platform'];
}

/** 로그인 방식 이름. 모르는 방식은 CLI가 준 값을 그대로 보인다. */
const AUTH_METHOD_LABELS: Record<string, string> = {
  'claude.ai': 'Claude 계정(claude.ai)',
  api_key_helper: 'apiKeyHelper',
  none: '로그인 안 됨',
};

/** 경로, 버전, 로그인 방식, PATH 출처, 찾아본 곳, CLI 오류 원문. */
function AgentDetails({ details, failure, platform }: AgentDetailsProps) {
  /** 자식 프로세스 PATH의 출처 문구. */
  const pathSource =
    details.pathSource === 'login-shell'
      ? '로그인 셸에서 읽음'
      : details.pathSource === 'app'
        ? platform === 'win32'
          ? '앱이 받은 PATH'
          : '앱이 받은 PATH(로그인 셸에서 읽지 못함)'
        : null;
  /** 찾아본 곳. 찾지 못했을 때만 보인다. */
  const searched =
    failure?.reason === 'not-found'
      ? [details.pathSource === 'login-shell' ? '로그인 셸의 PATH' : '앱이 받은 PATH', ...details.searchedDirs].join(', ')
      : null;

  return (
    <div className="agent-details">
      <dl>
        {searched !== null && (
          <>
            <dt>찾아본 곳</dt>
            <dd>{searched}</dd>
          </>
        )}
        {details.cliPath !== null && (
          <>
            <dt>경로</dt>
            <dd className="mono">{details.cliPath}</dd>
          </>
        )}
        {details.version !== null && (
          <>
            <dt>버전</dt>
            <dd>
              {details.version} (필요: {details.requiredVersion} 이상)
            </dd>
          </>
        )}
        {details.authMethod !== null && (
          <>
            <dt>로그인 방식</dt>
            <dd>{AUTH_METHOD_LABELS[details.authMethod] ?? details.authMethod}</dd>
          </>
        )}
        {pathSource !== null && (
          <>
            <dt>PATH</dt>
            <dd>{pathSource}</dd>
          </>
        )}
      </dl>
      {details.errorOutput !== null && <pre>{details.errorOutput}</pre>}
    </div>
  );
}
