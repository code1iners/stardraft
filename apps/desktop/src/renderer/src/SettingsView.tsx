import { useEffect, useState } from 'react';
import { isSettingsSection, SETTINGS_SECTIONS, type SettingsSection } from '../../shared/ipc';
import { AccountSwitchModal } from './AccountSwitchModal';
import { AgentSection } from './AgentSection';
import { DraftsSection } from './DraftsSection';
import { FlowAccountSection } from './FlowAccountSection';
import { GeneralSection } from './GeneralSection';
import { sectionNeedsSetup, SetupBand } from './Onboarding';
import { RepositoriesSection } from './RepositoriesSection';
import { SentrySection } from './SentrySection';
import { useSnapshot } from './useSnapshot';

/** 칸 목록에 보이는 칸 이름. */
const SECTION_LABELS: Record<SettingsSection, string> = {
  'flow-account': 'Flow 계정',
  sentry: 'Sentry',
  agent: '에이전트',
  repositories: '저장소',
  drafts: '초안',
  general: '일반',
};

/** 설정 창 화면에 넘기는 값. */
interface SettingsViewProps {
  /** 창을 열 때 main이 고른 칸. 없거나 모르는 값이면 첫 칸을 보인다. */
  initialSection: string | null;
  /** 창을 열 때 main이 짚은 Flow 프로젝트 ID. 저장소 매핑에서 그 줄을 보인다. 없으면 `null`. */
  initialProjectId?: string | null;
  /** 창을 열 때 main이 짚은 Sentry 프로젝트 ID. 저장소 매핑 `Sentry` 탭에서 그 줄을 보인다. 없으면 `null`. */
  initialSentryProjectId?: string | null;
}

/**
 * 설정 창. 왼쪽 칸 목록과 오른쪽 내용으로 이뤄진다. 아직 내용이 없는 칸은 제목만 보인다.
 * 감지를 시작하기 전에는 맨 위에 첫 설정 띠를 두고, 끝나지 않은 필수 칸에 점을 찍는다.
 */
export function SettingsView({ initialSection, initialProjectId = null, initialSentryProjectId = null }: SettingsViewProps) {
  /** 앱 상태 스냅숏. */
  const snapshot = useSnapshot();
  /** 지금 보이는 칸. */
  const [section, setSection] = useState<SettingsSection>(
    isSettingsSection(initialSection) ? initialSection : SETTINGS_SECTIONS[0],
  );

  /** 저장소 매핑에서 짚어 보일 Flow 프로젝트 ID. 짚지 않으면 `null`. */
  const [focusProjectId, setFocusProjectId] = useState<string | null>(initialProjectId);
  /** 저장소 매핑 `Sentry` 탭에서 짚어 보일 Sentry 프로젝트 ID. 짚지 않으면 `null`. */
  const [focusSentryProjectId, setFocusSentryProjectId] = useState<string | null>(initialSentryProjectId);
  /** 칸 요청을 받은 횟수. 같은 프로젝트를 다시 짚어도 저장소 칸을 새로 그려 짚은 탭과 줄로 돌아가게 한다. */
  const [sectionRequests, setSectionRequests] = useState(0);

  useEffect(function followSectionRequests() {
    return window.stardraft.onEvent((event) => {
      if (event.type !== 'settings-section-requested') return;
      setSection(event.section);
      setFocusProjectId(event.projectId ?? null);
      setFocusSentryProjectId(event.sentryProjectId ?? null);
      setSectionRequests((count) => count + 1);
    });
  }, []);

  /** 키 확인의 진행 상태. 스냅숏을 받기 전에는 없다. */
  const keyCheck = snapshot?.flowAccount.keyCheck;
  /** 다른 계정의 키라서 바꾸기 확인을 기다리는 계정과 그 계정의 기록을 보관해 두었는지 여부. 확인 창이 떠 있는 동안 뒤 화면은 누를 수 없다. */
  const switchingTo = keyCheck?.status === 'awaiting-confirmation' ? keyCheck : null;

  return (
    <>
      <div className="settings-window" inert={switchingTo !== null}>
        {snapshot && <SetupBand snapshot={snapshot} section={section} onSelectSection={setSection} />}
        <div className="settings">
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
                {snapshot && sectionNeedsSetup(snapshot, id) && <span className="settings-nav-dot" role="img" aria-label="설정 필요" />}
              </button>
            ))}
          </nav>
          <main className="settings-main">
            <h2>{SECTION_LABELS[section]}</h2>
            {section === 'flow-account' && snapshot && (
              <FlowAccountSection flowAccount={snapshot.flowAccount} keyNeedsCheck={snapshot.globalProblem?.cause === 'flow-key'} />
            )}
            {section === 'sentry' && snapshot && (
              <SentrySection sentry={snapshot.sentry} projects={snapshot.sentryProjects} reportFolder={snapshot.reportFolder} platform={snapshot.platform} />
            )}
            {section === 'agent' && snapshot && (
              <AgentSection
                agentConnections={snapshot.agentConnections}
                agentPreferences={snapshot.agentPreferences}
                parallelWork={snapshot.parallelWork}
                platform={snapshot.platform}
              />
            )}
            {section === 'repositories' && snapshot && (
              <RepositoriesSection
                key={sectionRequests}
                repoMappings={snapshot.repoMappings}
                sentryProjects={snapshot.sentryProjects}
                focusProjectId={focusProjectId}
                focusSentryProjectId={focusSentryProjectId}
              />
            )}
            {section === 'drafts' && snapshot && <DraftsSection snapshot={snapshot} />}
            {section === 'general' && <GeneralSection snapshot={snapshot} />}
          </main>
        </div>
      </div>
      {switchingTo && (
        <AccountSwitchModal account={switchingTo.account} current={snapshot?.flowAccount.account ?? null} stored={switchingTo.stored} />
      )}
    </>
  );
}
