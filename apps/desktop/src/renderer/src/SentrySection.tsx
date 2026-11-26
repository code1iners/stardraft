import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { globalProblemText } from '../../shared/global-problem-text';
import {
  SENTRY_TOKEN_MAX_LENGTH,
  type AppSnapshot,
  type SentryConnectionSnapshot,
  type SentryProjectSnapshot,
  type SentryProjectsSnapshot,
  type SentryTokenCheckFailure,
} from '../../shared/ipc';
import { SentryProjectModal } from './SentryProjectModal';
import { projectFilterSummary, projectStatus, projectStatusText } from './sentry-project-text';

/** 토큰 확인이 실패했을 때 입력 칸 아래에 보일 문구. 권한이 모자라면 빠진 scope 이름을 짚는다. */
const FAILURE_MESSAGES: Record<SentryTokenCheckFailure, string> = {
  unauthorized: '토큰이 맞지 않습니다. Sentry에서 다시 복사해 붙여 넣어 주세요.',
  'scope-missing': '토큰에 org:read 권한이 없습니다. org:read와 event:read 권한을 고른 새 토큰을 만들어 붙여 넣어 주세요.',
  'no-organizations': '이 토큰으로 볼 수 있는 조직이 없습니다. 조직에 속한 계정의 토큰인지, org:read 권한이 있는지 확인해 주세요.',
  network: 'Sentry에 연결할 수 없습니다. 인터넷 연결을 확인해 주세요.',
  'rate-limited': 'Sentry 요청이 많아 확인하지 못했습니다. 잠시 뒤 다시 시도해 주세요.',
  unexpected: 'Sentry가 요청을 처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요.',
  'save-failed': '토큰을 이 PC에 저장하지 못했습니다. 다시 시도해 주세요.',
};

/** 토큰을 고치지 않고 [다시 시도]로 다시 해 볼 만한 실패. 토큰이나 권한이 맞지 않으면 토큰을 고쳐야 하므로 넣지 않는다. */
const RETRYABLE_FAILURES: ReadonlySet<SentryTokenCheckFailure> = new Set(['network', 'rate-limited', 'unexpected', 'save-failed']);

/** "Sentry" 칸에 넘기는 값. */
interface SentrySectionProps {
  /** "Sentry" 칸의 상태. */
  sentry: SentryConnectionSnapshot;
  /** 진단하려고 등록한 프로젝트와 등록할 수 있는 프로젝트 목록. */
  projects: SentryProjectsSnapshot;
  /** 실행 중인 OS. 읽을 수 없는 이유의 문구가 OS마다 다르다. */
  platform: AppSnapshot['platform'];
}

/**
 * 설정 "Sentry" 칸. 토큰이 없으면 토큰 입력만, 있으면 토큰 카드(조직 수와 이름, 권한, 상태)와 "진단할 프로젝트" 목록을 보인다.
 * 토큰은 [확인]으로 Sentry에 확인되었을 때만 main이 저장하므로 저장 버튼은 없다. 토큰 문제는 이 칸의 Sentry만 멈춘다.
 */
export function SentrySection({ sentry, projects, platform }: SentrySectionProps) {
  /** 토큰 연결 여부, 확인의 진행 상태, "토큰 확인 필요"의 이유. */
  const { connected, tokenCheck, tokenProblem } = sentry;
  /** 연결된 토큰이 있을 때 [토큰 바꾸기]로 입력 칸을 연 상태. */
  const [editing, setEditing] = useState(false);
  /** 입력 칸의 토큰. 확인에 성공하면 비운다. */
  const [token, setToken] = useState('');
  /** 이 창에서 시작한 마지막 확인의 실패 이유. */
  const [failure, setFailure] = useState<SentryTokenCheckFailure | null>(null);
  /** 토큰 입력 칸. */
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(function followTokenCheckResults() {
    return window.stardraft.onEvent((event) => {
      if (event.type !== 'sentry-token-check-finished') return;
      if (event.result === 'connected') {
        setEditing(false);
        setToken('');
        setFailure(null);
      } else {
        setFailure(event.result);
      }
    });
  }, []);

  /** 확인이나 저장이 진행 중이라 입력을 막는지 여부. */
  const busy = tokenCheck.status === 'checking';

  /** 입력한 토큰으로 확인을 시작한다. [다시 시도]도 같은 토큰으로 이 경로를 탄다. */
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || token.trim() === '') return;
    setFailure(null);
    window.stardraft.send({ type: 'check-sentry-token', token }).catch(() => setFailure('unexpected'));
  };

  /** 연결된 토큰을 바꾸려고 입력 칸을 연다. */
  const handleEdit = () => {
    setEditing(true);
    setFailure(null);
  };

  /** 토큰 바꾸기를 그만두고 토큰 카드로 돌아간다. 진행 중인 확인도 그만둔다. */
  const handleCancel = () => {
    setEditing(false);
    setToken('');
    setFailure(null);
    void window.stardraft.send({ type: 'cancel-sentry-token-check' });
  };

  /** 연결을 끊는다. 토큰만 지운다. */
  const handleDisconnect = () => {
    setEditing(false);
    setToken('');
    setFailure(null);
    void window.stardraft.send({ type: 'disconnect-sentry' });
  };

  return (
    <>
      <p className="section-lead muted">Sentry의 새 오류 이슈를 감지하는 데 쓰는 개인 토큰입니다. 토큰이 문제여도 Flow 감지와 Flow 초안은 멈추지 않습니다.</p>
      {connected && !editing ? (
        <>
          <TokenCard
            sentry={sentry}
            problemMessage={tokenProblem && globalProblemText({ cause: 'sentry-token', reason: tokenProblem }, platform).message}
            onEdit={handleEdit}
            onDisconnect={handleDisconnect}
          />
          <ProjectList projects={projects} tokenProblem={tokenProblem !== null} />
        </>
      ) : (
        <form className="field" onSubmit={handleSubmit}>
          <label className="field-label" htmlFor="sentry-token">
            개인 토큰
          </label>
          <p className="field-help muted">
            Sentry의 <strong>사용자 설정 &gt; Personal Tokens</strong>에서 만듭니다. 권한은 <code>org:read</code>와 <code>event:read</code>를 고르세요. 만든 뒤에는 권한을
            바꿀 수 없습니다. 조직 토큰은 쓸 수 없습니다.
          </p>
          <div className="row">
            <input
              ref={inputRef}
              id="sentry-token"
              className="text-input key-input"
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="토큰을 붙여 넣으세요"
              maxLength={SENTRY_TOKEN_MAX_LENGTH}
              autoComplete="off"
              spellCheck={false}
              autoFocus={editing}
              disabled={busy}
            />
            {connected && (
              <button type="button" className="btn" onClick={handleCancel}>
                취소
              </button>
            )}
            <button type="submit" className="btn primary" disabled={busy || token.trim() === ''}>
              {busy ? '확인 중…' : '확인'}
            </button>
          </div>
          {failure && (
            <p className="field-error" role="alert">
              {FAILURE_MESSAGES[failure]}
              {RETRYABLE_FAILURES.has(failure) && (
                <>
                  {' '}
                  <button type="submit" className="btn link" disabled={busy}>
                    다시 시도
                  </button>
                </>
              )}
            </p>
          )}
        </form>
      )}
    </>
  );
}

/** 토큰 카드에 넘기는 값. */
interface TokenCardProps {
  /** "Sentry" 칸의 상태. */
  sentry: SentryConnectionSnapshot;
  /** "토큰 확인 필요"의 이유 문구. 문제가 없으면 `null`. */
  problemMessage: string | null;
  /** [토큰 바꾸기]나 [토큰 다시 입력]을 눌렀을 때. */
  onEdit: () => void;
  /** [연결 끊기]를 눌렀을 때. */
  onDisconnect: () => void;
}

/** 토큰으로 보이는 조직의 수와 이름, 확인된 권한, "연결됨"(토큰 확인이 필요하면 "토큰 확인 필요")을 보이는 카드. */
function TokenCard({ sentry, problemMessage, onEdit, onDisconnect }: TokenCardProps) {
  /** 토큰으로 보이는 조직 이름들. */
  const names = sentry.organizations.map((organization) => organization.name);
  return (
    <div className="field">
      <span className="field-label">연결된 토큰</span>
      <div className="account-card">
        <div className="account-info">
          <div className="account-name">
            <strong>조직 {names.length}개</strong>
            {names.length > 0 && ` · ${names.join(', ')}`}
          </div>
          <div className="muted small">
            {problemMessage ? '권한: 토큰을 다시 확인해야 합니다' : '권한: org:read 확인됨 · event:read는 프로젝트를 추가할 때 확인합니다'}
          </div>
        </div>
        {problemMessage ? <span className="danger-text small">토큰 확인 필요</span> : <span className="ok-text small">✓ 연결됨</span>}
        <button type="button" className="btn sm" onClick={onEdit}>
          {problemMessage ? '토큰 다시 입력' : '토큰 바꾸기'}
        </button>
        <button type="button" className="btn sm" onClick={onDisconnect}>
          연결 끊기
        </button>
      </div>
      {problemMessage && (
        <p className="field-error" role="alert">
          {problemMessage}
        </p>
      )}
      <p className="field-note muted">토큰은 이 PC에만 암호화해 보관합니다. 연결을 끊으면 토큰만 지우고 다른 설정은 그대로 둡니다.</p>
    </div>
  );
}

/** 진단할 프로젝트 목록에 넘기는 값. */
interface ProjectListProps {
  /** 등록한 프로젝트와 등록할 수 있는 프로젝트 목록. */
  projects: SentryProjectsSnapshot;
  /** "토큰 확인 필요"인지 여부. 그렇다면 [프로젝트 추가…]를 막고 모든 줄이 멈춘 것으로 보인다. */
  tokenProblem: boolean;
}

/** 모달이 열린 상태. 닫혀 있으면 `null`, 추가면 `'add'`, 편집이면 고치는 프로젝트의 ID다. */
type OpenModal = null | 'add' | { editing: string };

/** "진단할 프로젝트" 목록: 줄마다 `조직 / 프로젝트`, `환경 · 레벨 · 저장소 이름`, 상태, [편집]. [프로젝트 추가…]와 두 모달을 가진다. */
function ProjectList({ projects, tokenProblem }: ProjectListProps) {
  /** 열려 있는 모달. */
  const [modal, setModal] = useState<OpenModal>(null);
  /** 모달을 닫는다. 늘 같은 함수라 모달의 이벤트 구독이 다시 걸리지 않는다. */
  const closeModal = useCallback(() => setModal(null), []);

  useEffect(function refreshOnOpen() {
    // 칸을 열 때마다 등록한 프로젝트에 닿는지와 매핑된 폴더가 있는지 다시 확인한다.
    void window.stardraft.send({ type: 'refresh-sentry-projects' });
  }, []);

  /** 고치는 프로젝트. */
  const editing = typeof modal === 'object' && modal !== null ? (projects.projects.find((project) => project.projectId === modal.editing) ?? null) : null;

  return (
    <div className="field">
      <span className="field-label">진단할 프로젝트</span>
      {projects.projects.length === 0 ? (
        <p className="field-help muted">등록한 프로젝트가 없습니다. 프로젝트를 추가하면 그 프로젝트의 새 오류 이슈를 진단합니다.</p>
      ) : (
        <ul className="sentry-project-list">
          {projects.projects.map((project) => (
            <ProjectRow key={project.projectId} project={project} tokenProblem={tokenProblem} onEdit={() => setModal({ editing: project.projectId })} />
          ))}
        </ul>
      )}
      <div className="row">
        <button
          type="button"
          className="btn"
          disabled={tokenProblem}
          title={tokenProblem ? '토큰을 다시 확인한 뒤 추가할 수 있습니다.' : undefined}
          onClick={() => setModal('add')}
        >
          프로젝트 추가…
        </button>
      </div>
      {modal === 'add' && (
        <SentryProjectModal
          editing={null}
          registeredIds={new Set(projects.projects.map((project) => project.projectId))}
          candidates={projects.candidates}
          onClose={closeModal}
        />
      )}
      {editing && (
        <SentryProjectModal editing={editing} registeredIds={new Set()} candidates={projects.candidates} onClose={closeModal} />
      )}
    </div>
  );
}

/** 프로젝트 줄에 넘기는 값. */
interface ProjectRowProps {
  /** 등록한 프로젝트. */
  project: SentryProjectSnapshot;
  /** "토큰 확인 필요"인지 여부. */
  tokenProblem: boolean;
  /** [편집]을 눌렀을 때. */
  onEdit: () => void;
}

/** 프로젝트 줄. 상태는 감지 중, 저장소 매핑 없음 · n건 대기, 접근 불가, 토큰 확인 필요 중 하나다. */
function ProjectRow({ project, tokenProblem, onEdit }: ProjectRowProps) {
  /** 줄의 상태. */
  const status = projectStatus(project, tokenProblem);
  return (
    <li className="sentry-project-item">
      <div className="sentry-project-info">
        <div className="account-name">
          <strong>
            {project.organizationName} / {project.projectName}
          </strong>
        </div>
        <div className="muted small">{projectFilterSummary(project)}</div>
      </div>
      <span className={status === 'watching' ? 'ok-text small' : status === 'unmapped' ? 'warning-text small' : 'danger-text small'}>
        {projectStatusText(project, status)}
      </span>
      <button type="button" className="btn sm" onClick={onEdit}>
        편집
      </button>
    </li>
  );
}
