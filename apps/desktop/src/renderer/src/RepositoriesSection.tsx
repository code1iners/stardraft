import { useEffect, useRef, useState } from 'react';
import type {
  MappedRepoStatus,
  ParticipantProjectsFailure,
  ParticipantProjectsSnapshot,
  RepoMappingsSnapshot,
  SentryProjectsSnapshot,
} from '../../shared/ipc';
import { tabId, tabPanelId, UnderlineTabs, type UnderlineTab } from './UnderlineTabs';

/** 참여 Flow 프로젝트 목록을 받지 못한 이유 문구. */
const PROJECTS_FAILURE_TEXT: Record<ParticipantProjectsFailure, string> = {
  'no-key': 'Flow 계정을 먼저 연결해야 Flow 프로젝트를 고를 수 있습니다.',
  unauthorized: 'Flow가 키를 거부해 Flow 프로젝트 목록을 불러오지 못했습니다.',
  network: 'Flow에 연결할 수 없어 Flow 프로젝트 목록을 불러오지 못했습니다.',
  'rate-limited': '요청이 많아 Flow 프로젝트 목록을 불러오지 못했습니다. 잠시 뒤 다시 불러와 주세요.',
  unexpected: 'Flow 프로젝트 목록을 불러오지 못했습니다.',
};

/** 저장소 매핑 탭. 매핑의 키가 되는 서비스마다 하나다. */
type MappingTab = 'flow' | 'sentry';

/** 저장소 매핑 탭의 id 앞부분. */
const MAPPING_TABS_ID = 'repo-mapping';

/** "저장소" 칸에 넘기는 값. */
interface RepositoriesSectionProps {
  /** 저장소 매핑과 고를 참여 Flow 프로젝트 목록. */
  repoMappings: RepoMappingsSnapshot;
  /** 진단하려고 등록한 Sentry 프로젝트와 그 저장소 매핑. */
  sentryProjects: SentryProjectsSnapshot;
  /** 검토 화면의 [저장소 매핑하기]·[매핑 고치기]로 짚은 Flow 프로젝트 ID. 그 줄을 눈에 띄게 하고 보이는 곳으로 가져온다. 없으면 `null`. */
  focusProjectId?: string | null;
  /** 진단의 [저장소 매핑하기]·[매핑 고치기]로 짚은 Sentry 프로젝트 ID. `Sentry` 탭을 열고 그 줄을 짚는다. 없으면 `null`. */
  focusSentryProjectId?: string | null;
}

/**
 * 설정 "저장소" 칸. "저장소 매핑"을 `Flow` | `Sentry` 탭으로 나눠 프로젝트마다 저장소를 연결하고,
 * 매핑이 없어 기다리는 프로젝트를 탭 맨 위에 보인다. 매핑이 없는 프로젝트가 있는 탭에는 점이 찍힌다.
 */
export function RepositoriesSection({ repoMappings, sentryProjects, focusProjectId = null, focusSentryProjectId = null }: RepositoriesSectionProps) {
  /** 보이는 탭. Sentry 프로젝트를 짚었으면 `Sentry` 탭이다. */
  const [tab, setTab] = useState<MappingTab>(focusSentryProjectId === null ? 'flow' : 'sentry');

  /** 마지막으로 탭에 반영한 짚기. */
  const [shownFocus, setShownFocus] = useState({ flow: focusProjectId, sentry: focusSentryProjectId });
  // 열린 창에서 다른 프로젝트를 짚으면 그 서비스의 탭으로 옮긴다. 이전 렌더의 짚기와 견주는 것이라 렌더 중에 바꾼다.
  if (shownFocus.flow !== focusProjectId || shownFocus.sentry !== focusSentryProjectId) {
    setShownFocus({ flow: focusProjectId, sentry: focusSentryProjectId });
    if (focusSentryProjectId !== null) setTab('sentry');
    else if (focusProjectId !== null) setTab('flow');
  }

  useEffect(function refreshOnOpen() {
    // 칸을 열 때마다 연결된 폴더와 참여 Flow 프로젝트 목록, 등록한 Sentry 프로젝트에 닿는지를 다시 확인한다.
    void window.stardraft.send({ type: 'refresh-repo-mappings' });
    void window.stardraft.send({ type: 'refresh-sentry-projects' });
  }, []);

  /** 탭 목록. 매핑이 없어 기다리는 프로젝트가 있는 탭에 점을 찍는다. */
  const tabs: UnderlineTab<MappingTab>[] = [
    { id: 'flow', label: 'Flow', dot: repoMappings.waiting.length > 0 },
    { id: 'sentry', label: 'Sentry', dot: sentryProjects.projects.some((project) => project.repo === null) },
  ];

  return (
    <div className="field">
      <span className="field-label">저장소 매핑</span>
      <UnderlineTabs label="저장소 매핑" idPrefix={MAPPING_TABS_ID} tabs={tabs} selected={tab} onSelect={setTab} />
      <div role="tabpanel" id={tabPanelId(MAPPING_TABS_ID, tab)} aria-labelledby={tabId(MAPPING_TABS_ID, tab)}>
        {tab === 'flow' ? (
          <RepoMappingsField repoMappings={repoMappings} focusProjectId={focusProjectId} />
        ) : (
          <SentryRepoMappingsField sentryProjects={sentryProjects} focusProjectId={focusSentryProjectId} />
        )}
      </div>
    </div>
  );
}

/** 저장소 매핑 목록에 넘기는 값. */
interface RepoMappingsFieldProps {
  /** 저장소 매핑과 고를 참여 Flow 프로젝트 목록. */
  repoMappings: RepoMappingsSnapshot;
  /** 짚은 Flow 프로젝트 ID. 없으면 `null`. */
  focusProjectId: string | null;
}

/** 저장소 매핑 목록. Flow 프로젝트마다 연결한 저장소를 보이고, 참여 Flow 프로젝트를 골라 새 매핑을 만든다. */
function RepoMappingsField({ repoMappings, focusProjectId }: RepoMappingsFieldProps) {
  /** 짚은 프로젝트의 줄. */
  const focusedRow = useRef<HTMLLIElement | null>(null);
  /** 짚은 프로젝트의 줄이 목록에 있는지 여부. 목록을 받은 뒤에야 줄이 생긴다. */
  const hasFocusedRow = [...repoMappings.mappings, ...repoMappings.waiting].some((item) => item.projectId === focusProjectId);
  useEffect(
    function scrollToFocusedRow() {
      if (hasFocusedRow) focusedRow.current?.scrollIntoView?.({ block: 'center' });
    },
    [focusProjectId, hasFocusedRow],
  );

  /** 새 매핑으로 고른 Flow 프로젝트 ID. 고르지 않았으면 빈 문자열. */
  const [selected, setSelected] = useState('');
  /** 참여 Flow 프로젝트 목록의 상태. */
  const { projects } = repoMappings;
  /** 이미 매핑이 있거나 매핑을 기다리는 Flow 프로젝트 ID. 새 매핑 선택 상자에서는 뺀다. */
  const mapped = new Set([...repoMappings.mappings, ...repoMappings.waiting].map((mapping) => mapping.projectId));
  /** 새 매핑으로 고를 수 있는 Flow 프로젝트. */
  const choices = projects.status === 'loaded' ? projects.projects.filter((project) => !mapped.has(project.projectId)) : [];
  /** 고른 프로젝트가 아직 고를 수 있는지 여부. 연결해 매핑이 생기면 목록에서 빠진다. */
  const selectedAvailable = choices.some((project) => project.projectId === selected);

  return (
    <>
      <p className="field-help muted">
        Flow 프로젝트에 저장소를 연결하면 그 프로젝트의 멘션은 연결된 저장소를 모두 읽습니다. 연결하지 않은 프로젝트의 멘션은 저장소를 연결할 때까지 기다립니다.
      </p>
      {(repoMappings.waiting.length > 0 || repoMappings.mappings.length > 0) && (
        <ul className="folder-list">
          {repoMappings.waiting.map((waiting) => (
            <li
              key={`waiting-${waiting.projectId}`}
              className="folder-item"
              ref={waiting.projectId === focusProjectId ? focusedRow : undefined}
              aria-current={waiting.projectId === focusProjectId ? 'true' : undefined}
            >
              <div className="folder-row">
                <span className="mapping-title">{projectLabel(waiting.projectId, waiting.title)}</span>
                <span className="warning-text">저장소 매핑 없음 · {waiting.waitingCount}건 대기</span>
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => void window.stardraft.send({ type: 'pick-mapping-repos', projectId: waiting.projectId })}
                >
                  폴더 고르기…
                </button>
              </div>
            </li>
          ))}
          {repoMappings.mappings.map((mapping) => (
            <li
              key={mapping.projectId}
              className="folder-item"
              ref={mapping.projectId === focusProjectId ? focusedRow : undefined}
              aria-current={mapping.projectId === focusProjectId ? 'true' : undefined}
            >
              <div className="folder-row">
                <span className="mapping-title">{projectLabel(mapping.projectId, mapping.title)}</span>
                {mapping.missing && <span className="danger-text">폴더를 찾을 수 없음</span>}
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => void window.stardraft.send({ type: 'pick-mapping-repos', projectId: mapping.projectId })}
                >
                  폴더 추가…
                </button>
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => void window.stardraft.send({ type: 'remove-repo-mapping', projectId: mapping.projectId })}
                >
                  매핑 지우기
                </button>
              </div>
              <ul className="mapping-repos">
                {mapping.repos.map(({ path, status }) => (
                  <li key={path} className="folder-row">
                    <span className="folder-path" title={path}>
                      {path}
                    </span>
                    <MappedRepoStatusText status={status} />
                    <button
                      type="button"
                      className="btn sm"
                      onClick={() => void window.stardraft.send({ type: 'remove-mapping-repo', projectId: mapping.projectId, path })}
                    >
                      빼기
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      <div className="row">
        <select
          aria-label="연결할 Flow 프로젝트"
          className="text-input model-select"
          value={selectedAvailable ? selected : ''}
          disabled={choices.length === 0}
          onChange={(event) => setSelected(event.target.value)}
        >
          <option value="">{projectsPlaceholder(projects, choices.length)}</option>
          {choices.map((project) => (
            <option key={project.projectId} value={project.projectId}>
              {projectLabel(project.projectId, project.title)}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn"
          disabled={!selectedAvailable}
          onClick={() => void window.stardraft.send({ type: 'pick-mapping-repos', projectId: selected })}
        >
          폴더 골라 연결…
        </button>
      </div>
      {projects.status === 'failed' && (
        <p className="field-error" role="alert">
          {PROJECTS_FAILURE_TEXT[projects.reason]}{' '}
          <button type="button" className="btn link" onClick={() => void window.stardraft.send({ type: 'refresh-repo-mappings' })}>
            다시 불러오기
          </button>
        </p>
      )}
    </>
  );
}

/** Sentry 탭에 넘기는 값. */
interface SentryRepoMappingsFieldProps {
  /** 진단하려고 등록한 Sentry 프로젝트와 그 저장소 매핑. */
  sentryProjects: SentryProjectsSnapshot;
  /** 짚은 Sentry 프로젝트 ID. 없으면 `null`. */
  focusProjectId?: string | null;
}

/**
 * `Sentry` 탭. 등록한 프로젝트가 모두 오른다. 저장소는 프로젝트 하나에 하나라서 [폴더 추가…] 대신 [바꾸기…]를 둔다.
 * 매핑이 없는 프로젝트는 맨 위에 "저장소 매핑 없음 · n건 대기"와 [폴더 고르기…]로 보인다. 모달의 저장소와 같은 값이다.
 * 진단에서 짚은 프로젝트의 줄은 눈에 띄게 하고 보이는 곳으로 가져온다.
 */
export function SentryRepoMappingsField({ sentryProjects, focusProjectId = null }: SentryRepoMappingsFieldProps) {
  /** 짚은 프로젝트의 줄. */
  const focusedRow = useRef<HTMLLIElement | null>(null);
  /** 짚은 프로젝트가 등록되어 줄이 있는지 여부. */
  const hasFocusedRow = sentryProjects.projects.some((project) => project.projectId === focusProjectId);
  useEffect(
    function scrollToFocusedRow() {
      if (hasFocusedRow) focusedRow.current?.scrollIntoView?.({ block: 'center' });
    },
    [focusProjectId, hasFocusedRow],
  );

  /** 매핑이 없는 프로젝트. */
  const unmapped = sentryProjects.projects.filter((project) => project.repo === null);
  /** 저장소가 매핑된 프로젝트. */
  const mapped = sentryProjects.projects.filter((project) => project.repo !== null);
  return (
    <>
      <p className="field-help muted">
        등록한 프로젝트마다 저장소를 하나 연결하면 그 프로젝트의 오류 이슈를 연결된 저장소에서 진단합니다. 연결하지 않은 프로젝트의 오류 이슈는 저장소를 연결할 때까지
        기다립니다. 같은 저장소를 여러 프로젝트에 연결할 수 있습니다.
      </p>
      {sentryProjects.projects.length === 0 ? (
        <p className="muted small">등록한 프로젝트가 없습니다. Sentry 칸에서 프로젝트를 추가해 주세요.</p>
      ) : (
        <ul className="folder-list">
          {unmapped.map((project) => (
            <li
              key={project.projectId}
              className="folder-item"
              ref={project.projectId === focusProjectId ? focusedRow : undefined}
              aria-current={project.projectId === focusProjectId ? 'true' : undefined}
            >
              <div className="folder-row">
                <span className="mapping-title">
                  {project.organizationName} / {project.projectName}
                </span>
                <span className="warning-text">저장소 매핑 없음 · {project.waitingCount}건 대기</span>
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => void window.stardraft.send({ type: 'pick-sentry-project-repo', projectId: project.projectId })}
                >
                  폴더 고르기…
                </button>
              </div>
            </li>
          ))}
          {mapped.map((project) => (
            <li
              key={project.projectId}
              className="folder-item"
              ref={project.projectId === focusProjectId ? focusedRow : undefined}
              aria-current={project.projectId === focusProjectId ? 'true' : undefined}
            >
              <div className="folder-row">
                <span className="mapping-title">
                  {project.organizationName} / {project.projectName}
                </span>
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => void window.stardraft.send({ type: 'pick-sentry-project-repo', projectId: project.projectId })}
                >
                  바꾸기…
                </button>
              </div>
              {project.repo && (
                <ul className="mapping-repos">
                  <li className="folder-row">
                    <span className="folder-path" title={project.repo.path}>
                      {project.repo.path}
                    </span>
                    <MappedRepoStatusText status={project.repo.status} />
                  </li>
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** 화면에 보일 Flow 프로젝트 이름. 이름을 모르거나 비었으면 ID로 대신한다. */
function projectLabel(projectId: string, title: string | null): string {
  return title || `Flow 프로젝트 ${projectId}`;
}

/** Flow 프로젝트 선택 상자의 첫 줄 문구. */
function projectsPlaceholder(projects: ParticipantProjectsSnapshot, choiceCount: number): string {
  if (projects.status === 'loading' || projects.status === 'idle') return 'Flow 프로젝트를 불러오는 중…';
  if (projects.status === 'failed') return 'Flow 프로젝트를 불러오지 못함';
  return choiceCount > 0 ? 'Flow 프로젝트 고르기' : '연결할 Flow 프로젝트가 없습니다';
}

/** 매핑된 저장소 줄의 폴더 상태. 있으면 아무것도 보이지 않는다. */
function MappedRepoStatusText({ status }: { status: MappedRepoStatus }) {
  if (status === 'checking') return <span className="muted">확인 중…</span>;
  if (status === 'missing') return <span className="danger-text">폴더를 찾을 수 없음</span>;
  return null;
}
