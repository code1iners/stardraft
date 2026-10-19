import type { StardraftBridge } from '../shared/ipc';

declare global {
  interface Window {
    /** preload가 노출한 IPC. */
    stardraft: StardraftBridge;
  }
}
