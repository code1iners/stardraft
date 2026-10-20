import { useEffect, useState } from 'react';
import type {
  MappedRepoStatus,
  ParticipantProjectsFailure,
  ParticipantProjectsSnapshot,
  RejectedFolderReason,
  RepoMappingsSnapshot,
  WorkFolderScanSnapshot,
  WorkFoldersSnapshot,
} from '../../shared/ipc';

/** 받지 않은 폴더의 이유 문구. */
const REJECTED_TEXT: Record<RejectedFolderReason, string> = {
  network: '네트워크 폴더는 작업 폴더로 쓸 수 없습니다. 이 PC에 있는 폴더를 골라 주세요.',
  wsl: 'WSL 폴더는 작업 폴더로 쓸 수 없습니다. Windows 쪽에 있는 폴더를 골라 주세요.',
};

/** 참여 Flow 프로젝트 목록을 받지 못한 이유 문구. */
const PROJECTS_FAILURE_TEXT: Record<ParticipantProjectsFailure, string> = {
  'no-key': 'Flow 계정을 먼저 연결해야 Flow 프로젝트를 고를 수 있습니다.',
  unauthorized: 'Flow가 키를 거부해 Flow 프로젝트 목록을 불러오지 못했습니다.',
  network: 'Flow에 연결할 수 없어 Flow 프로젝트 목록을 불러오지 못했습니다.',
  'rate-limited': '요청이 많아 Flow 프로젝트 목록을 불러오지 못했습니다. 잠시 뒤 다시 불러와 주세요.',
  unexpected: 'Flow 프로젝트 목록을 불러오지 못했습니다.',
};

/** "저장소" 칸에 넘기는 값. */
interface RepositoriesSectionProps {
  /** 작업 폴더와 "이 PC에서 찾은 폴더". */
  workFolders: WorkFoldersSnapshot;
  /** 저장소 매핑과 고를 참여 Flow 프로젝트 목록. */
  repoMappings: RepoMappingsSnapshot;
}

/** 설정 "저장소" 칸. 작업 폴더를 더하고 지우며, 폴더마다 찾은 저장소 수와 이름을 보인다. */
export function RepositoriesSection({ workFolders, repoMappings }: RepositoriesSectionProps) {
  /** 저장소 이름을 펼친 작업 폴더. */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  useEffect(function refreshOnOpen() {
    // 칸을 열 때마다 다시 훑어, 앱을 켠 뒤 새로 받은 저장소도 보이게 한다.
    void window.stardraft.send({ type: 'refresh-work-folders' });
    void window.stardraft.send({ type: 'refresh-repo-mappings' });
  }, []);

  /** 작업 폴더의 저장소 이름을 펼치거나 접는다. */
  const toggle = (path: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return (
    <>
      <div className="field">
        <span className="field-label">작업 폴더</span>
        <p className="field-help muted">연결이 없는 멘션은 이 폴더들에서 찾은 저장소 가운데 에이전트가 골라 읽습니다. 3단계 깊이까지 찾습니다.</p>
        {workFolders.folders.length > 0 && (
          <ul className="folder-list">
            {workFolders.folders.map(({ path, scan }) => (
              <li key={path} className="folder-item">
                <div className="folder-row">
                  <span className="folder-path" title={path}>
                    {path}
                  </span>
                  <ScanSummary scan={scan} expanded={expanded.has(path)} onToggle={() => toggle(path)} />
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => void window.stardraft.send({ type: 'remove-work-folder', path })}
                  >
                    지우기
                  </button>
                </div>
                {scan.status === 'found' && scan.repos.length === 0 && (
                  <p className="folder-warning">이 폴더에서 저장소를 찾지 못했습니다. 저장소가 든 상위 폴더를 골랐는지 확인해 주세요.</p>
                )}
                {scan.status === 'found' && scan.repos.length > 0 && expanded.has(path) && (
                  <ul className="repo-names">
                    {scan.repos.map((repo) => (
                      <li key={repo.path} title={repo.path}>
                        {repo.name}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="row">
          <button type="button" className="btn" onClick={() => void window.stardraft.send({ type: 'pick-work-folders' })}>
            폴더 추가…
          </button>
        </div>
        {workFolders.rejected.map(({ path, reason }) => (
          <p key={path} className="field-error" role="alert">
            {path}: {REJECTED_TEXT[reason]}
          </p>
        ))}
      </div>
      {workFolders.suggestions.length > 0 && (
        <div className="field">
          <span className="field-label">이 PC에서 찾은 폴더</span>
          <ul className="folder-list">
            {workFolders.suggestions.map(({ path, repoCount }) => (
              <li key={path} className="folder-item">
                <div className="folder-row">
                  <span className="folder-path" title={path}>
                    {path}
                  </span>
                  <span className="muted">저장소 {repoCount}개</span>
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => void window.stardraft.send({ type: 'add-suggested-work-folder', path })}
                  >
                    추가
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      <RepoMappingsField repoMappings={repoMappings} />
    </>
  );
}

/** 저장소 매핑 목록에 넘기는 값. */
interface RepoMappingsFieldProps {
  /** 저장소 매핑과 고를 참여 Flow 프로젝트 목록. */
  repoMappings: RepoMappingsSnapshot;
}

/** 저장소 매핑 목록. Flow 프로젝트마다 연결한 저장소를 보이고, 참여 Flow 프로젝트를 골라 새 매핑을 만든다. */
function RepoMappingsField({ repoMappings }: RepoMappingsFieldProps) {
  /** 새 매핑으로 고른 Flow 프로젝트 ID. 고르지 않았으면 빈 문자열. */
  const [selected, setSelected] = useState('');
  /** 참여 Flow 프로젝트 목록의 상태. */
  const { projects } = repoMappings;
  /** 이미 매핑이 있는 Flow 프로젝트 ID. */
  const mapped = new Set(repoMappings.mappings.map((mapping) => mapping.projectId));
  /** 새 매핑으로 고를 수 있는 Flow 프로젝트. */
  const choices = projects.status === 'loaded' ? projects.projects.filter((project) => !mapped.has(project.projectId)) : [];
  /** 고른 프로젝트가 아직 고를 수 있는지 여부. 연결해 매핑이 생기면 목록에서 빠진다. */
  const selectedAvailable = choices.some((project) => project.projectId === selected);

  return (
    <div className="field">
      <span className="field-label">저장소 매핑</span>
      <p className="field-help muted">
        Flow 프로젝트에 저장소를 연결하면 그 프로젝트의 멘션은 연결된 저장소를 모두 읽습니다. 연결하지 않은 프로젝트는 작업 폴더에서 고릅니다.
      </p>
      {repoMappings.mappings.length > 0 && (
        <ul className="folder-list">
          {repoMappings.mappings.map((mapping) => (
            <li key={mapping.projectId} className="folder-item">
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
    </div>
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

/** 저장소 수 표시에 넘기는 값. */
interface ScanSummaryProps {
  /** 작업 폴더를 훑은 상태. */
  scan: WorkFolderScanSnapshot;
  /** 저장소 이름을 펼쳤는지 여부. */
  expanded: boolean;
  /** 펼치거나 접는다. */
  onToggle: () => void;
}

/** 작업 폴더 줄의 저장소 수. 저장소가 있으면 눌러서 이름을 펼친다. */
function ScanSummary({ scan, expanded, onToggle }: ScanSummaryProps) {
  if (scan.status === 'scanning') return <span className="muted">찾는 중…</span>;
  if (scan.status === 'missing') return <span className="danger-text">폴더를 찾을 수 없음</span>;
  if (scan.repos.length === 0) return <span className="warning-text">저장소 0개</span>;
  return (
    <button type="button" className="btn link" aria-expanded={expanded} onClick={onToggle}>
      저장소 {scan.repos.length}개 {expanded ? '▴' : '▾'}
    </button>
  );
}
