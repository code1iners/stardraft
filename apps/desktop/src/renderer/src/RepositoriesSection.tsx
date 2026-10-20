import { useEffect, useState } from 'react';
import type { RejectedFolderReason, WorkFolderScanSnapshot, WorkFoldersSnapshot } from '../../shared/ipc';

/** 받지 않은 폴더의 이유 문구. */
const REJECTED_TEXT: Record<RejectedFolderReason, string> = {
  network: '네트워크 폴더는 작업 폴더로 쓸 수 없습니다. 이 PC에 있는 폴더를 골라 주세요.',
  wsl: 'WSL 폴더는 작업 폴더로 쓸 수 없습니다. Windows 쪽에 있는 폴더를 골라 주세요.',
};

/** "저장소" 칸에 넘기는 값. */
interface RepositoriesSectionProps {
  /** 작업 폴더와 "이 PC에서 찾은 폴더". */
  workFolders: WorkFoldersSnapshot;
}

/** 설정 "저장소" 칸. 작업 폴더를 더하고 지우며, 폴더마다 찾은 저장소 수와 이름을 보인다. */
export function RepositoriesSection({ workFolders }: RepositoriesSectionProps) {
  /** 저장소 이름을 펼친 작업 폴더. */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  useEffect(function refreshOnOpen() {
    // 칸을 열 때마다 다시 훑어, 앱을 켠 뒤 새로 받은 저장소도 보이게 한다.
    void window.stardraft.send({ type: 'refresh-work-folders' });
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
    </>
  );
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
