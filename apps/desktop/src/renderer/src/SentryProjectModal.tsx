import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  SENTRY_LEVEL_IDS,
  type SentryCandidateSnapshot,
  type SentryCandidatesSnapshot,
  type SentryLevelId,
  type SentryProjectSaveResult,
  type SentryProjectSnapshot,
} from '../../shared/ipc';
import { CANDIDATES_FAILURE_TEXT, SAVE_FAILURE_TEXT, environmentLabel } from './sentry-project-text';

/** 모든 환경을 뜻하는 선택 상자 값. 환경 이름과 겹치지 않게 빈 문자열을 쓴다. */
const ALL_ENVIRONMENTS = '';

/** 프로젝트 모달에 넘기는 값. */
interface SentryProjectModalProps {
  /** 고쳐 쓸 등록한 프로젝트. 없으면 프로젝트를 골라 추가하는 모달이다. */
  editing: SentryProjectSnapshot | null;
  /** 이미 등록한 프로젝트 ID. 추가 모달의 선택 목록에서 뺀다. */
  registeredIds: ReadonlySet<string>;
  /** 등록할 수 있는 프로젝트 목록의 상태. */
  candidates: SentryCandidatesSnapshot;
  /** 모달을 닫는다. */
  onClose: () => void;
}

/** 필터 기본값에 쓰는 환경. `production`이 있으면 그것, 없으면 모든 환경이다. */
function defaultEnvironment(environments: readonly string[]): string {
  return environments.includes('production') ? 'production' : ALL_ENVIRONMENTS;
}

/**
 * Sentry 프로젝트를 추가하거나 고치는 화면 가운데 모달. 추가할 때만 프로젝트를 고르고,
 * 환경 필터(프로젝트의 환경 목록에서 고름)와 레벨 필터, 저장소(선택)를 정한다. 고치는 모달에는 [등록 해제]가 있다.
 * 모달의 저장소는 "저장소" 칸 `Sentry` 탭의 저장소와 같은 값이다. 등록이 끝나면 main이 `sentry-project-saved`로 알려 모달을 닫는다.
 */
export function SentryProjectModal({ editing, registeredIds, candidates, onClose }: SentryProjectModalProps) {
  /** 추가 모달에서 고른 프로젝트 ID. */
  const [projectId, setProjectId] = useState('');
  /** 고른 환경. `ALL_ENVIRONMENTS`는 모든 환경이다. */
  const [environment, setEnvironment] = useState(editing ? (editing.environment ?? ALL_ENVIRONMENTS) : ALL_ENVIRONMENTS);
  /** 고른 레벨. */
  const [levels, setLevels] = useState<SentryLevelId[]>(editing ? editing.levels : ['fatal', 'error']);
  /** 고른 저장소 폴더. 없으면 `null`. */
  const [repoPath, setRepoPath] = useState<string | null>(editing?.repo?.path ?? null);
  /** 저장 요청을 보내고 결과를 기다리는 중인지 여부. */
  const [saving, setSaving] = useState(false);
  /** 마지막 저장의 실패 이유. */
  const [failure, setFailure] = useState<Exclude<SentryProjectSaveResult, 'registered' | 'updated'> | null>(null);
  /** [등록 해제]를 눌러 한 번 더 묻는 중인지 여부. */
  const [confirmingUnregister, setConfirmingUnregister] = useState(false);
  /** 처음 초점을 줄 [취소] 버튼. */
  const cancelRef = useRef<HTMLButtonElement>(null);

  /** 목록에서 고를 수 있는 프로젝트(이미 등록한 것은 뺀다). */
  const choices: SentryCandidateSnapshot[] =
    candidates.status === 'loaded' ? candidates.projects.filter((project) => !registeredIds.has(project.projectId)) : [];
  /** 지금 다루는 프로젝트의 환경 목록. 고치는 모달에서 목록을 받지 못했으면 지금 고른 환경만 보인다. */
  const environments: string[] = editing
    ? (() => {
        /** 받아 둔 목록의 이 프로젝트. */
        const found = candidates.status === 'loaded' ? candidates.projects.find((project) => project.projectId === editing.projectId) : undefined;
        /** 환경 목록. 지금 필터의 환경이 목록에 없어도 고른 값은 남긴다. */
        const names = found?.environments ?? [];
        return editing.environment !== null && !names.includes(editing.environment) ? [editing.environment, ...names] : names;
      })()
    : (choices.find((project) => project.projectId === projectId)?.environments ?? []);

  useEffect(function loadCandidatesOnOpen() {
    void window.stardraft.send({ type: 'load-sentry-candidates' });
  }, []);

  useEffect(function focusCancelOnOpen() {
    cancelRef.current?.focus();
  }, []);

  useEffect(
    function followSaveResults() {
      return window.stardraft.onEvent((event) => {
        if (event.type === 'sentry-draft-folder-picked') {
          setRepoPath(event.path);
        } else if (event.type === 'sentry-project-saved') {
          setSaving(false);
          if (event.result === 'registered' || event.result === 'updated') onClose();
          else setFailure(event.result);
        }
      });
    },
    [onClose],
  );

  /** 프로젝트를 고른다. 환경은 그 프로젝트의 기본값(`production`이 있으면 그것)으로 맞춘다. */
  const handleSelectProject = (id: string) => {
    setProjectId(id);
    setEnvironment(defaultEnvironment(choices.find((project) => project.projectId === id)?.environments ?? []));
    setFailure(null);
  };

  /** 레벨 하나를 켜거나 끈다. 심각한 순서로 둔다. */
  const toggleLevel = (level: SentryLevelId) => {
    setLevels((current) => SENTRY_LEVEL_IDS.filter((id) => (id === level ? !current.includes(id) : current.includes(id))));
  };

  /** 저장할 수 있는지 여부. 레벨은 하나 이상이고, 추가할 때는 프로젝트를 골랐다. */
  const canSave = !saving && levels.length > 0 && (editing !== null || projectId !== '');

  /** 등록하거나 고친 내용을 저장한다. */
  const handleSave = () => {
    if (!canSave) return;
    setSaving(true);
    setFailure(null);
    /** 보낼 필터. */
    const filters = { environment: environment === ALL_ENVIRONMENTS ? null : environment, levels, repoPath };
    /** 보낼 명령. */
    const command = editing
      ? ({ type: 'update-sentry-project', projectId: editing.projectId, ...filters } as const)
      : ({ type: 'register-sentry-project', projectId, ...filters } as const);
    window.stardraft.send(command).catch(() => {
      setSaving(false);
      setFailure('unexpected');
    });
  };

  /** 등록을 푼다. */
  const handleUnregister = () => {
    if (!editing) return;
    void window.stardraft.send({ type: 'unregister-sentry-project', projectId: editing.projectId });
    onClose();
  };

  /** Esc는 [취소]와 같다. */
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') onClose();
  };

  return (
    <div className="modal-backdrop">
      <div className="modal sentry-project-modal" role="dialog" aria-modal="true" aria-labelledby="sentry-project-title" onKeyDown={handleKeyDown}>
        <h3 id="sentry-project-title">{editing ? '진단할 프로젝트 편집' : '진단할 프로젝트 추가'}</h3>

        <div className="field">
          <span className="field-label">프로젝트</span>
          {editing ? (
            <div>
              {editing.organizationName} / {editing.projectName}
            </div>
          ) : (
            <>
              <select
                aria-label="프로젝트"
                className="text-input model-select"
                value={projectId}
                disabled={choices.length === 0 || saving}
                onChange={(event) => handleSelectProject(event.target.value)}
              >
                <option value="">{projectPlaceholder(candidates, choices.length)}</option>
                {choices.map((project) => (
                  <option key={project.projectId} value={project.projectId}>
                    {project.organizationName} / {project.projectName}
                  </option>
                ))}
              </select>
              {candidates.status === 'failed' && (
                <p className="field-error" role="alert">
                  {CANDIDATES_FAILURE_TEXT[candidates.reason]}{' '}
                  {candidates.reason !== 'no-token' && (
                    <button type="button" className="btn link" onClick={() => void window.stardraft.send({ type: 'load-sentry-candidates' })}>
                      다시 불러오기
                    </button>
                  )}
                </p>
              )}
              {candidates.status === 'loaded' && candidates.incomplete && (
                <p className="field-note muted">일부 조직의 프로젝트 목록은 불러오지 못했습니다.</p>
              )}
            </>
          )}
        </div>

        <div className="field">
          <label className="field-label" htmlFor="sentry-environment">
            환경
          </label>
          <select
            id="sentry-environment"
            className="text-input model-select"
            value={environment}
            disabled={saving}
            onChange={(event) => setEnvironment(event.target.value)}
          >
            <option value={ALL_ENVIRONMENTS}>{environmentLabel(null)}</option>
            {environments.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>

        <fieldset className="field plain-fieldset" disabled={saving}>
          <legend className="field-label">레벨</legend>
          <div className="level-options">
            {SENTRY_LEVEL_IDS.map((level) => (
              <label key={level} className="choice-row">
                <input type="checkbox" checked={levels.includes(level)} onChange={() => toggleLevel(level)} />
                {level}
              </label>
            ))}
          </div>
          {levels.length === 0 && <p className="field-error">레벨은 하나 이상 골라 주세요.</p>}
        </fieldset>

        <div className="field">
          <span className="field-label">저장소 · 선택</span>
          <div className="folder-row sentry-repo-row">
            {repoPath === null ? (
              <span className="muted">지정 안 함</span>
            ) : (
              <span className="folder-path" title={repoPath}>
                {repoPath}
              </span>
            )}
            <button type="button" className="btn sm" disabled={saving} onClick={() => void window.stardraft.send({ type: 'pick-sentry-draft-folder' })}>
              {repoPath === null ? '폴더 고르기…' : '바꾸기…'}
            </button>
            {repoPath !== null && (
              <button type="button" className="btn sm" disabled={saving} onClick={() => setRepoPath(null)}>
                지우기
              </button>
            )}
          </div>
        </div>

        {failure && (
          <p className="field-error" role="alert">
            {SAVE_FAILURE_TEXT[failure]}
          </p>
        )}

        {confirmingUnregister && (
          <p className="field-error" role="alert">
            등록을 풀면 이 프로젝트의 저장소 매핑도 지워집니다. 다시 등록하면 그때부터의 오류 이슈만 봅니다.
          </p>
        )}

        <div className="modal-actions">
          {editing &&
            (confirmingUnregister ? (
              <>
                <button type="button" className="btn danger" onClick={handleUnregister}>
                  등록 해제
                </button>
                <button type="button" className="btn" onClick={() => setConfirmingUnregister(false)}>
                  해제 안 함
                </button>
              </>
            ) : (
              <button type="button" className="btn danger sentry-unregister" disabled={saving} onClick={() => setConfirmingUnregister(true)}>
                등록 해제
              </button>
            ))}
          <button ref={cancelRef} type="button" className="btn" onClick={onClose}>
            취소
          </button>
          <button type="button" className="btn primary" disabled={!canSave} onClick={handleSave}>
            {saving ? '확인 중…' : editing ? '저장' : '등록'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 프로젝트 선택 상자의 첫 줄 문구. */
function projectPlaceholder(candidates: SentryCandidatesSnapshot, choiceCount: number): string {
  if (candidates.status === 'idle' || candidates.status === 'loading') return '프로젝트를 불러오는 중…';
  if (candidates.status === 'failed') return '프로젝트를 불러오지 못함';
  return choiceCount > 0 ? '프로젝트 고르기' : '등록할 프로젝트가 없습니다';
}
