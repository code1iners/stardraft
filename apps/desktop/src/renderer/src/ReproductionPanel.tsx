import { useEffect } from 'react';
import { AGENT_INFO } from '../../shared/agent-info';
import type { ReproductionServerSnapshot, ReproductionSnapshot, ReproductionToolModeId } from '../../shared/ipc';
import { SERVER_KIND_LABELS } from './reproduction-text';

/** 목록에 서버가 없을 때의 안내. */
const NO_SERVERS_TEXT = '셸로만 재현, 조작이 필요하면 불가(도구 없음)';
/** 플러그인 MCP와 커넥터가 실리지 않는다는 안내. */
const NOT_LOADED_TEXT = '플러그인 MCP와 커넥터는 실리지 않습니다. 조작용 MCP는 에이전트(CLI)에 직접 등록해 주세요.';
/** `자동`의 경고. */
const AUTO_WARNING = '외부로 보내는 MCP도 함께 실립니다.';
/** `직접 선택`의 안내. */
const MANUAL_NOTE = '고른 서버만 실립니다. 새로 등록한 서버는 꺼진 채로 나타납니다. 저장소의 프로젝트 정의 파일에 있는 서버는 목록에 없고 실리지 않습니다.';

/** 방식 라디오 하나. */
const MODES: readonly { id: ReproductionToolModeId; label: string }[] = [
  { id: 'auto', label: '자동' },
  { id: 'manual', label: '직접 선택' },
];

/** `재현` 탭에 넘기는 값. */
interface ReproductionPanelProps {
  /** 재현 도구 권한과 MCP 서버 목록. */
  reproduction: ReproductionSnapshot;
}

/**
 * 설정 "에이전트" 칸의 `재현` 탭(macOS만). **재현 도구 권한**: 라디오 `자동`(기본)과 `직접 선택`, 그리고 에이전트에 등록된 MCP 서버 목록.
 * 줄마다 이름, 종류, 출처 CLI, 앱이 뺀 위험 도구를 보이고 외부로 보낼 수 있는 서버에는 "외부로 보냄" 꼬리표를 붙인다.
 * 서버 정의의 값(환경 변수, 헤더)은 화면에 없다. 탭을 열 때마다 목록을 다시 읽는다.
 */
export function ReproductionPanel({ reproduction }: ReproductionPanelProps) {
  /** 재현 도구 권한. */
  const { mode, status, servers, codexListFailed } = reproduction.tools;

  useEffect(function readServersOnOpen() {
    void window.stardraft.send({ type: 'refresh-reproduction-servers' });
  }, []);

  return (
    <>
      <fieldset className="field plain-fieldset">
        <legend className="field-label">재현 도구 권한</legend>
        <p className="field-help muted">재현할 때 에이전트가 쓸 수 있는 MCP 서버를 정합니다.</p>
        {MODES.map(({ id, label }) => (
          <label key={id} className="choice-row">
            <input
              type="radio"
              name="reproduction-tool-mode"
              value={id}
              checked={mode === id}
              onChange={() => void window.stardraft.send({ type: 'set-reproduction-tool-mode', mode: id })}
            />
            {label}
          </label>
        ))}
      </fieldset>

      {mode === 'auto' && <p className="warning-text">{AUTO_WARNING}</p>}
      {mode === 'manual' && <p className="field-help muted">{MANUAL_NOTE}</p>}

      {status !== 'loaded' && servers.length === 0 ? (
        <p className="muted small" role="status">
          MCP 서버 목록을 읽는 중…
        </p>
      ) : servers.length === 0 ? (
        <p className="muted small">{NO_SERVERS_TEXT}</p>
      ) : (
        <ul className="folder-list reproduction-servers" aria-label="MCP 서버 목록">
          {servers.map((server) => (
            <ServerRow key={`${server.agent}:${server.name}`} server={server} selectable={mode === 'manual'} />
          ))}
        </ul>
      )}
      {codexListFailed && (
        <p className="field-error" role="alert">
          Codex의 MCP 서버 목록을 읽지 못했습니다.
        </p>
      )}
      <p className="field-help muted">{NOT_LOADED_TEXT}</p>
    </>
  );
}

/** 서버 줄에 넘기는 값. */
interface ServerRowProps {
  /** 서버 하나. */
  server: ReproductionServerSnapshot;
  /** `직접 선택`이라 체크 상자를 보이는지 여부. */
  selectable: boolean;
}

/** MCP 서버 한 줄. */
function ServerRow({ server, selectable }: ServerRowProps) {
  /** 이름과 꼬리표 부분. */
  const info = (
    <span className="reproduction-server-info">
      <span className="mapping-title">{server.name}</span>
      <span className="muted">
        {SERVER_KIND_LABELS[server.kind]} · {AGENT_INFO[server.agent].name}
      </span>
      {server.external && <span className="tag warn">외부로 보냄</span>}
      {server.deniedTools.length > 0 && <span className="muted small">앱이 뺀 도구: {server.deniedTools.join(', ')}</span>}
    </span>
  );

  return (
    <li className="folder-item">
      {selectable ? (
        <label className="choice-row">
          <input
            type="checkbox"
            checked={server.enabled}
            onChange={(event) =>
              void window.stardraft.send({ type: 'set-reproduction-server-enabled', agent: server.agent, name: server.name, enabled: event.target.checked })
            }
          />
          {info}
        </label>
      ) : (
        <div className="folder-row">{info}</div>
      )}
    </li>
  );
}
