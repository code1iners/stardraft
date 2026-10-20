import { useEffect, useState } from 'react';
import { isSettingsSection, SETTINGS_SECTIONS, type SettingsSection } from '../../shared/ipc';
import { AccountSwitchSheet } from './AccountSwitchSheet';
import { AgentSection } from './AgentSection';
import { FlowAccountSection } from './FlowAccountSection';
import { GeneralSection } from './GeneralSection';
import { RepositoriesSection } from './RepositoriesSection';
import { useSnapshot } from './useSnapshot';

/** 칸 목록에 보이는 칸 이름. */
const SECTION_LABELS: Record<SettingsSection, string> = {
  'flow-account': 'Flow 계정',
  agent: '에이전트',
  repositories: '저장소',
  drafts: '초안',
  general: '일반',
};

/** 설정 창 화면에 넘기는 값. */
interface SettingsViewProps {
  /** 창을 열 때 main이 고른 칸. 없거나 모르는 값이면 첫 칸을 보인다. */
  initialSection: string | null;
}

/** 설정 창. 왼쪽 칸 목록과 오른쪽 내용으로 이뤄진다. 아직 내용이 없는 칸은 제목만 보인다. */
export function SettingsView({ initialSection }: SettingsViewProps) {
  /** 앱 상태 스냅숏. */
  const snapshot = useSnapshot();
  /** 지금 보이는 칸. */
  const [section, setSection] = useState<SettingsSection>(
    isSettingsSection(initialSection) ? initialSection : SETTINGS_SECTIONS[0],
  );

  useEffect(function followSectionRequests() {
    return window.stardraft.onEvent((event) => {
      if (event.type === 'settings-section-requested') setSection(event.section);
    });
  }, []);

  /** 키 확인의 진행 상태. 스냅숏을 받기 전에는 없다. */
  const keyCheck = snapshot?.flowAccount.keyCheck;
  /** 다른 계정의 키라서 바꾸기 확인을 기다리는 계정. 확인 시트가 떠 있는 동안 뒤 화면은 누를 수 없다. */
  const switchingTo = keyCheck?.status === 'awaiting-confirmation' ? keyCheck.account : null;

  return (
    <>
      <div className="settings" inert={switchingTo !== null}>
        <nav className="settings-nav" aria-label="설정 칸">
          {SETTINGS_SECTIONS.map((id) => (
            <button
              key={id}
              type="button"
              className="settings-nav-item"
              aria-current={id === section ? 'page' : undefined}
              onClick={() => setSection(id)}
            >
              {SECTION_LABELS[id]}
            </button>
          ))}
        </nav>
        <main className="settings-main">
          <h2>{SECTION_LABELS[section]}</h2>
          {section === 'flow-account' && snapshot && (
            <FlowAccountSection flowAccount={snapshot.flowAccount} keyNeedsCheck={snapshot.globalProblem?.cause === 'flow-key'} />
          )}
          {section === 'agent' && snapshot && (
            <AgentSection agentConnection={snapshot.agentConnection} agentPreferences={snapshot.agentPreferences} platform={snapshot.platform} />
          )}
          {section === 'repositories' && snapshot && <RepositoriesSection workFolders={snapshot.workFolders} />}
          {section === 'general' && <GeneralSection snapshot={snapshot} />}
        </main>
      </div>
      {switchingTo && <AccountSwitchSheet account={switchingTo} />}
    </>
  );
}
