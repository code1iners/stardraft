import { useEffect, useState } from 'react';
import type { ReproductionRepoSnapshot } from '../../shared/ipc';
import { ReproductionConfirmModal } from './ReproductionConfirmModal';
import { ENV_FILE_UNSET_TEXT } from './reproduction-text';

/** "재현" 항목에 넘기는 값. */
interface ReproductionReposProps {
  /** 재현 허용을 정할 수 있는(매핑된) 저장소. */
  repos: ReproductionRepoSnapshot[];
}

/**
 * 설정 "저장소" 칸의 "재현" 항목(macOS만). 매핑된 저장소마다 재현 허용 체크 상자가 있고, 켜면 재현용 환경 파일과
 * [바꾸기…]/[파일 고르기…]가 보인다. 환경 파일을 지정하지 않았으면 "지정 안 함 · 원본 .env 사용"이 빨간 글씨로 보인다.
 * 켜는 순간 확인 모달이 뜨고, 취소하면 켜지지 않는다. 끄는 것은 바로 반영한다.
 */
export function ReproductionRepos({ repos }: ReproductionReposProps) {
  /** 확인 모달을 연 저장소 경로. 없으면 `null`. */
  const [confirming, setConfirming] = useState<string | null>(null);

  useEffect(function refreshOnOpen() {
    // 칸을 열 때 지정한 환경 파일이 아직 있는지 다시 확인한다.
    void window.stardraft.send({ type: 'refresh-reproduction-repos' });
  }, []);

  /** 확인 모달을 연 저장소. 매핑이 풀려 사라졌으면 없다. */
  const confirmingRepo = repos.find((repo) => repo.path === confirming) ?? null;

  /** 체크 상자를 눌렀을 때. 켜려면 확인 모달을 먼저 띄우고, 끄는 것은 바로 보낸다. */
  const handleToggle = (repo: ReproductionRepoSnapshot) => {
    if (repo.enabled) void window.stardraft.send({ type: 'set-reproduction-enabled', repoPath: repo.path, enabled: false });
    else setConfirming(repo.path);
  };

  return (
    <div className="field">
      <span className="field-label">재현</span>
      <p className="field-help muted">
        켜 둔 저장소의 오류 진단은 내 PC에서 오류를 직접 따라 해 봅니다. 켜지 않은 저장소는 지금처럼 읽기만 합니다.
      </p>
      {repos.length === 0 ? (
        <p className="muted small">매핑된 저장소가 없습니다. 위에서 저장소를 연결해 주세요.</p>
      ) : (
        <ul className="folder-list">
          {repos.map((repo) => (
            <li key={repo.path} className="folder-item">
              <label className="choice-row">
                <input type="checkbox" checked={repo.enabled} onChange={() => handleToggle(repo)} />
                <span className="folder-path" title={repo.path}>
                  {repo.path}
                </span>
                <span className="muted">재현 허용</span>
              </label>
              {repo.enabled && (
                <div className="folder-row reproduction-env">
                  <span className="muted">환경 파일</span>
                  {repo.envFile === null ? (
                    <span className="danger-text path-text">{ENV_FILE_UNSET_TEXT}</span>
                  ) : (
                    <span className="folder-path path-text" title={repo.envFile}>
                      {repo.envFile}
                    </span>
                  )}
                  {repo.envFileMissing && <span className="danger-text">파일을 찾을 수 없음</span>}
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => void window.stardraft.send({ type: 'pick-reproduction-env-file', repoPath: repo.path })}
                  >
                    {repo.envFile === null ? '파일 고르기…' : '바꾸기…'}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {confirmingRepo && (
        <ReproductionConfirmModal repoPath={confirmingRepo.path} initialEnvFile={confirmingRepo.envFile} onClose={() => setConfirming(null)} />
      )}
    </div>
  );
}
