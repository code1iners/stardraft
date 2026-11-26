import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PopoverView } from './PopoverView';
import { ReviewView } from './ReviewView';
import { SettingsView } from './SettingsView';
import './styles.css';

/** main이 창을 열 때 주소에 넣은 값. */
const params = new URLSearchParams(window.location.search);
/** 이 창이 그릴 화면. */
const view = params.get('view');
/** 창을 열 때 고른 멘션 묶음 ID. 없거나 숫자가 아니면 `null`. */
const initialBundleId = Number.parseInt(params.get('bundle') ?? '', 10) || null;
/** 창을 열 때 고른 진단 ID. 없거나 숫자가 아니면 `null`. */
const initialDiagnosisId = Number.parseInt(params.get('diagnosis') ?? '', 10) || null;
/** 렌더러를 붙일 요소. */
const root = document.getElementById('root');

/** 주소의 화면 이름에 맞는 화면. */
function viewFor(name: string | null) {
  if (name === 'settings') {
    return <SettingsView initialSection={params.get('section')} initialProjectId={params.get('project')} initialSentryProjectId={params.get('sentryProject')} />;
  }
  if (name === 'review') return <ReviewView initialBundleId={initialBundleId} initialDiagnosisId={initialDiagnosisId} />;
  return <PopoverView initialBundleId={initialBundleId} initialDiagnosisId={initialDiagnosisId} />;
}

if (root) {
  createRoot(root).render(<StrictMode>{viewFor(view)}</StrictMode>);
}
