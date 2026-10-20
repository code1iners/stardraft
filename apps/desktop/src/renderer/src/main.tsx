import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PopoverView } from './PopoverView';
import { SettingsView } from './SettingsView';
import './styles.css';

/** main이 창을 열 때 주소에 넣은 값. */
const params = new URLSearchParams(window.location.search);
/** 이 창이 그릴 화면. */
const view = params.get('view');
/** 렌더러를 붙일 요소. */
const root = document.getElementById('root');

if (root) {
  createRoot(root).render(
    <StrictMode>{view === 'settings' ? <SettingsView initialSection={params.get('section')} /> : <PopoverView />}</StrictMode>,
  );
}
