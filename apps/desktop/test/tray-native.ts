import assert from 'node:assert/strict';
import { app, BrowserWindow, Menu, nativeTheme, systemPreferences } from 'electron';
import { trayIndicator, type TrayIndicatorInput } from '../src/core/tray-indicator';
import { AppTray, type TrayActions } from '../src/main/tray';
import { TrayImages } from '../src/main/tray-images';

void app.whenReady().then(() => {
  app.setName('Stardraft 트레이 검증');
  app.dock?.hide();
  /** 화면 도구로 선택할 수 있는 검증 전용 창. */
  const window = new BrowserWindow({ width: 500, height: 220, title: 'Stardraft 트레이 검증', webPreferences: { sandbox: true } });
  void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent('<html lang="ko"><title>Stardraft 트레이 검증</title><body style="font:14px system-ui;padding:18px"><p>메뉴 막대에 세 아이콘을 표시했습니다.</p><p>빈 윤곽 · 채움과 pulse · 45도 취소선</p><p>검증 메뉴에서 가운데 아이콘의 상태를 바꿉니다.</p><p>아이콘 우클릭 → 종료로 검증 앱을 닫습니다.</p></body></html>')}`);
  process.on('SIGTERM', () => app.quit());
  /** 실제 이미지의 배율·템플릿 속성을 검사한다. */
  const images = new TrayImages();
  for (const kind of ['idle', 'problem', 'review'] as const) {
    for (const frame of kind === 'review' ? [0, 20, 39] : [0]) {
      /** 런타임에서 디코딩한 이미지. */
      const image = images.get(kind, frame, nativeTheme.shouldUseDarkColorsForSystemIntegratedUI);
      assert.equal(image.isEmpty(), false);
      assert.equal(image.isTemplateImage(), process.platform === 'darwin');
      assert.deepEqual(image.getScaleFactors(), process.platform === 'darwin' ? [1, 2] : [1, 1.25, 1.5, 2]);
      assert.deepEqual(image.getSize(), { width: 16, height: 16 });
      assert.equal(image.toBitmap({ scaleFactor: 2 }).length, 32 * 32 * 4);
    }
  }
  /** 검증 전용 아이콘. 실제 계정·묶음·서비스에는 연결하지 않는다. */
  const trays: AppTray[] = [];
  /** 실제 서비스 호출 대신 검증 로그를 남기는 동작. */
  const actions: TrayActions = {
    togglePopover: () => {
      if (window.isVisible()) window.hide();
      else window.show();
      console.log('왼쪽 클릭 확인');
    },
    openPopover: () => { window.show(); console.log('창 열기 메뉴 확인'); },
    openSettings: () => console.log('설정 메뉴 확인'),
    checkNow: () => console.log('지금 확인 메뉴 확인'),
    runUpdateAction: () => {},
    quit: () => app.quit(),
  };
  for (const indicator of [{ kind: 'idle', generating: false }, { kind: 'review', count: 12 }, { kind: 'problem', reason: 'setup-needed' }] as const) {
    /** 세 상태를 나란히 표시하는 실제 트레이. */
    const tray = new AppTray(actions);
    trays.push(tray);
    tray.show({ indicator, problem: null, canCheckNow: true });
    console.log(indicator.kind, tray.getBounds());
  }
  /** 가운데 아이콘에 공급할 실제 도메인 입력. 운영 계정 대신 검증용 값만 사용한다. */
  let state: TrayIndicatorInput = { hasGlobalProblem: false, setupNeeded: false, hasFailure: false, reviewCount: 12, generating: false };
  /** 상태 계산부터 네이티브 표시까지 같은 경계로 검증한다. */
  function update(patch: Partial<TrayIndicatorInput>): void {
    state = { ...state, ...patch };
    trays[1]!.show({ indicator: trayIndicator(state), problem: null, canCheckNow: true });
    console.log('검증 상태 변경', state, trayIndicator(state));
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Stardraft 트레이 검증', submenu: [{ label: '종료', role: 'quit' }] },
    { label: '검증', submenu: [
      { label: '검토 대기 3건', click: () => update({ reviewCount: 3 }) },
      { label: '검토 대기 12건', click: () => update({ reviewCount: 12 }) },
      { label: '실패 발생', click: () => update({ hasFailure: true }) },
      { label: '실패 해결', click: () => update({ hasFailure: false }) },
      { label: '검토 모두 처리', click: () => update({ reviewCount: 0 }) },
      { label: '생성 중', click: () => update({ generating: true }) },
      { label: '생성 완료', click: () => update({ generating: false }) },
      { type: 'separator' },
      { label: '검증 창 열기', click: actions.openPopover },
    ] },
  ]));
  setTimeout(() => console.log('배치 후 경계', trays.map(tray => tray.getBounds())), 1000);
  console.log('네이티브 이미지 검사 통과', { platform: process.platform, electron: process.versions.electron, reducedMotion: systemPreferences.getAnimationSettings().prefersReducedMotion });
  app.on('before-quit', () => {
    for (const tray of trays) { tray.destroy(); tray.destroy(); }
    console.log('트레이 폐기 완료');
  });
  // 검증 창을 방치하지 않도록 5분 뒤 자동으로 정리한다.
  setTimeout(() => app.quit(), 300000).unref();
}).catch(error => { console.error(error); app.exit(1); });
