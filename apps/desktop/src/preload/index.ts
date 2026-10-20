import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC_CHANNELS, type AppEvent, type StardraftBridge } from '../shared/ipc';

/** 렌더러에 노출하는 IPC. 이 객체 말고는 main에 닿는 길이 없다. */
const bridge: StardraftBridge = {
  getSnapshot: () => ipcRenderer.invoke(IPC_CHANNELS.getSnapshot),
  send: (command) => ipcRenderer.invoke(IPC_CHANNELS.command, command),
  onEvent: (listener) => {
    /** IPC 이벤트에서 이벤트 객체만 꺼내 넘기는 핸들러. 렌더러에 `IpcRendererEvent`를 넘기지 않는다. */
    const handleEvent = (_event: IpcRendererEvent, appEvent: AppEvent) => listener(appEvent);
    ipcRenderer.on(IPC_CHANNELS.event, handleEvent);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.event, handleEvent);
    };
  },
};

contextBridge.exposeInMainWorld('stardraft', bridge);
