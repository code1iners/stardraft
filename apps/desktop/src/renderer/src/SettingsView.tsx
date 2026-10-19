import { useEffect, useState } from 'react';
import { isSettingsSection, SETTINGS_SECTIONS, type SettingsSection } from '../../shared/ipc';

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

/** 설정 창. 왼쪽 칸 목록과 오른쪽 내용으로 이뤄진다. 각 칸의 내용은 아직 비어 있다. */
export function SettingsView({ initialSection }: SettingsViewProps) {
  /** 지금 보이는 칸. */
  const [section, setSection] = useState<SettingsSection>(
    isSettingsSection(initialSection) ? initialSection : SETTINGS_SECTIONS[0],
  );

  useEffect(function followSectionRequests() {
    return window.stardraft.onEvent((event) => {
      if (event.type === 'settings-section-requested') setSection(event.section);
    });
  }, []);

  return (
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
          </button>
        ))}
      </nav>
      <main className="settings-main">
        <h2>{SECTION_LABELS[section]}</h2>
      </main>
    </div>
  );
}
