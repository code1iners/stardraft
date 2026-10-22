import { createContext, useContext, type ReactNode } from 'react';
import { exampleTarget, type ExampleSceneId, type ExampleState } from '../lib/example-scenes';
import { Star } from './TrayArt';

/** 장면 안의 버튼이 함께 쓰는 값. */
type SceneControls = {
  /** 지금 누를 곳. */
  target: string | null;
  /** 장면 안의 버튼을 눌렀을 때. */
  onPress: (button: string) => void;
};

/** 장면 안의 버튼에 지금 누를 곳과 누를 때 할 일을 건넨다. */
const SceneControlsContext = createContext<SceneControls>({ target: null, onPress: () => {} });

/** 눌러 볼 수 있는 버튼. 지금 누를 곳이면 강조 테두리를 두르고 커서가 가리키는 `data-target`을 단다. */
function Hot({ name, className, children }: { name: string; className: string; children: ReactNode }) {
  const { target, onPress } = useContext(SceneControlsContext);
  /** 지금 누를 곳인지. */
  const isTarget = target === name;
  return (
    <button
      type="button"
      className={isTarget ? `${className} ex-target` : className}
      data-target={isTarget ? '' : undefined}
      onClick={() => onPress(name)}
    >
      {children}
    </button>
  );
}

/** Stardraft 앱 아이콘. */
function AppIcon({ size }: { size: number }) {
  return (
    <span className="appicon" style={{ width: size, height: size }}>
      <Star size={Math.round(size * 0.62)} />
    </span>
  );
}

/** macOS 창의 닫기·최소화·확대 단추. */
function Lights() {
  return (
    <span className="lights">
      <i />
      <i />
      <i />
    </span>
  );
}

/** macOS 메뉴 막대. 설치를 마친 모습이면 별 아이콘을 표시한다. */
function MacMenuBar({ found }: { found: boolean }) {
  return (
    <div className="m-bar">
      <b>Finder</b>
      <span>파일</span>
      <span>편집</span>
      <span>보기</span>
      <span className="r">
        <i className="ico" />
        <i className="ico" />
        <span className={found ? 'star ex-found' : 'star'}>
          <Star size={13} />
        </span>
        <span>금 오후 3:12</span>
      </span>
    </div>
  );
}

/** Windows 설치 창. */
function WindowsInstaller({ reduced }: { reduced: boolean }) {
  return (
    <div className="w-inst">
      <div className="w-title">
        <span>Stardraft 설치</span>
        <span className="w-ctl">✕</span>
      </div>
      <div className="w-inst-body">
        설치하는 중입니다. 잠시 기다려 주세요.
        <div className="w-bar">
          <i className={reduced ? 'full' : undefined} />
        </div>
      </div>
    </div>
  );
}

/** macOS ①: DMG 창. 앱 아이콘을 누르면 Applications 폴더로 옮겨 간다. */
function MacDmg({ phase, reduced }: { phase: string; reduced: boolean }) {
  /** 옮긴 뒤인지. */
  const moved = phase === 'moved';
  return (
    <div className="m-win">
      <div className="m-titlebar">
        <Lights />
        Stardraft
      </div>
      <div className="dmg-body">
        {moved ? (
          // 옮겨 가는 아이콘. 동작 줄이기면 옮긴 뒤 모습(빈자리)만 보인다.
          <span className={reduced ? 'dmg-item left' : 'dmg-item leaving'}>
            <AppIcon size={54} />
            <span>Stardraft</span>
          </span>
        ) : (
          <Hot name="drag" className="dmg-item">
            <AppIcon size={54} />
            <span>Stardraft</span>
          </Hot>
        )}
        <svg className="dmg-arrow" width="64" height="20" viewBox="0 0 64 20" aria-hidden="true">
          <path d="M2 10h56m-8-7 8 7-8 7" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className={moved ? 'dmg-item got' : 'dmg-item'}>
          <span className="folder-ico">A</span>
          <span>Applications</span>
        </span>
      </div>
    </div>
  );
}

/** macOS ②: 처음 열면 뜨는 "열지 않음" 창. */
function MacBlocked({ phase }: { phase: string }) {
  if (phase === 'closed') return <span className="desk-note">창을 닫았습니다. 앱은 응용 프로그램 폴더에 그대로 있습니다.</span>;
  return (
    <div className="m-alert">
      <AppIcon size={52} />
      <div className="m-alert-title">‘Stardraft’을(를) 열지 않음</div>
      <div className="m-alert-body">Apple은 ‘Stardraft’에 Mac을 손상시키거나 개인 정보를 침해할 수 있는 악성 코드가 없음을 확인할 수 없습니다.</div>
      <div className="m-btns">
        <Hot name="trash" className="m-btn">
          휴지통으로 이동
        </Hot>
        <Hot name="done" className="m-btn def">
          완료
        </Hot>
      </div>
    </div>
  );
}

/** macOS ③: 시스템 설정 > 개인정보 보호 및 보안의 보안 항목. */
function MacSettings() {
  /** 시스템 설정 옆 목록. */
  const side = ['Wi‑Fi', 'Bluetooth', '네트워크', '알림', '일반', '손쉬운 사용'];
  return (
    <div className="m-win">
      <div className="m-titlebar">
        <Lights />
      </div>
      <div className="m-set">
        <div className="m-side">
          {side.map((name) => (
            <div key={name}>{name}</div>
          ))}
          <div className="sel">개인정보 보호 및 보안</div>
          <div>데스크탑 및 Dock</div>
        </div>
        <div className="m-main">
          <h5>개인정보 보호 및 보안</h5>
          <div className="m-group">
            <div className="m-row dim">위치 서비스</div>
            <div className="m-row dim">연락처</div>
          </div>
          <div className="m-head">보안</div>
          <div className="m-group">
            <div className="m-row">
              <span>다음에서 다운로드한 응용 프로그램 허용</span>
              <span className="dim">App Store 및 알려진 개발자</span>
            </div>
            <div className="m-row">
              <span>‘Stardraft’이(가) Mac을 보호하기 위해 차단되었습니다.</span>
              <Hot name="open" className="m-btn">
                그래도 열기
              </Hot>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** macOS ④: 한 번 더 묻는 창과 암호 입력 창. */
function MacConfirm({ phase }: { phase: string }) {
  if (phase === 'opened') {
    return (
      <>
        <MacMenuBar found />
        <span className="desk-note">Stardraft가 켜졌습니다.</span>
      </>
    );
  }
  if (phase === 'password') {
    return (
      <div className="m-auth">
        <div className="m-alert-title">‘개인정보 보호 및 보안’이(가) 설정을 변경하려고 합니다.</div>
        <div className="m-alert-body">허용하려면 암호를 입력하십시오.</div>
        <span className="m-input">사용자</span>
        <span className="m-input">••••••••</span>
        <div className="m-btns two">
          <span className="m-btn">취소</span>
          <Hot name="ok" className="m-btn def">
            설정 수정
          </Hot>
        </div>
      </div>
    );
  }
  return (
    <div className="m-alert">
      <AppIcon size={52} />
      <div className="m-alert-title">‘Stardraft’을(를) 열겠습니까?</div>
      <div className="m-alert-body">Apple은 ‘Stardraft’에 악성 코드가 없음을 확인할 수 없습니다. 출처를 신뢰하는 경우에만 여십시오.</div>
      <div className="m-btns">
        <Hot name="open" className="m-btn def">
          그래도 열기
        </Hot>
        <Hot name="done" className="m-btn">
          완료
        </Hot>
      </div>
    </div>
  );
}

/** macOS ⑤: 알림 허용을 묻는 배너와 메뉴 막대의 아이콘. */
function MacDone({ phase }: { phase: string }) {
  /** 알림을 허용한 뒤인지. */
  const allowed = phase === 'allowed';
  return (
    <>
      <MacMenuBar found={allowed} />
      {allowed ? (
        <span className="desk-note">오른쪽 위 별 아이콘이 Stardraft입니다.</span>
      ) : (
        <div className="m-banner">
          <AppIcon size={30} />
          <div>
            <b>‘Stardraft’ 알림</b>
            경고, 사운드, 아이콘 배지가 알림에 포함될 수 있습니다.
            <Hot name="allow" className="m-btn def">
              허용
            </Hot>
          </div>
        </div>
      )}
    </>
  );
}

/** Windows ①: Windows 보안 > 앱 & 브라우저 컨트롤 > 스마트 앱 컨트롤 설정. */
function WinSmartAppControl({ phase }: { phase: string }) {
  /** Windows 보안 왼쪽 목록. */
  const nav = ['홈', '바이러스 및 위협 방지', '계정 보호', '방화벽 및 네트워크 보호'];
  /** 홈 화면인지. */
  const home = phase === 'start';
  return (
    <div className="w-win">
      <div className="w-title">
        <span>Windows 보안</span>
        <span className="w-ctl">— ☐ ✕</span>
      </div>
      <div className="w-sec">
        <div className="w-nav">
          {nav.map((name) => (
            <div key={name} className={home && name === '홈' ? 'sel' : undefined}>
              {name}
            </div>
          ))}
          {home ? (
            <Hot name="app-browser" className="w-nav-item">
              앱 &amp; 브라우저 컨트롤
            </Hot>
          ) : (
            <div className="sel">앱 &amp; 브라우저 컨트롤</div>
          )}
          <div>장치 보안</div>
        </div>
        <div className="w-main">
          {home && (
            <>
              <h5>한눈에 보는 보안</h5>
              <p className="w-desc">디바이스의 보안 및 상태를 확인하고 필요한 조치를 취하세요.</p>
            </>
          )}
          {phase === 'app-browser' && (
            <>
              <h5>앱 &amp; 브라우저 컨트롤</h5>
              <p className="w-desc">앱 보호 및 온라인 보안을 위한 설정입니다.</p>
              <div className="w-block">
                <b>스마트 앱 컨트롤</b>
                <p className="w-desc">신뢰할 수 없거나 서명되지 않은 앱을 차단합니다.</p>
                <Hot name="sac-settings" className="w-link">
                  스마트 앱 컨트롤 설정
                </Hot>
              </div>
            </>
          )}
          {phase === 'status' && (
            <>
              <div className="w-crumb">앱 &amp; 브라우저 컨트롤 › 스마트 앱 컨트롤</div>
              <h5>스마트 앱 컨트롤</h5>
              <p className="w-desc">신뢰할 수 없거나 서명되지 않은 앱을 차단해 추가로 보호합니다.</p>
              <div className="w-radios">
                <div className="w-radio">
                  <i />
                  <div>
                    <b>켜기</b>
                    <span>신뢰할 수 없는 앱을 차단합니다.</span>
                  </div>
                </div>
                <div className="w-radio on">
                  <i />
                  <div>
                    <b>평가</b>
                    <span>적합한지 확인하는 동안에는 아무것도 차단하지 않습니다.</span>
                  </div>
                </div>
                <div className="w-radio">
                  <i />
                  <div>
                    <b>끄기</b>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Windows ②: "Windows의 PC 보호" 창. 추가 정보를 누르면 실행이 나타난다. */
function WinSmartScreen({ phase, reduced }: { phase: string; reduced: boolean }) {
  if (phase === 'installing') return <WindowsInstaller reduced={reduced} />;
  /** 추가 정보를 누른 뒤인지. */
  const more = phase === 'more';
  return (
    <div className="w-ss">
      <h5>Windows의 PC 보호</h5>
      <p>Microsoft Defender SmartScreen에서 인식할 수 없는 앱의 시작을 차단했습니다. 이 앱을 실행하면 PC가 위험에 노출될 수 있습니다.</p>
      {more ? (
        <p className="meta">
          앱: Stardraft-Setup-0.1.0.exe
          <br />
          게시자: 알 수 없는 게시자
        </p>
      ) : (
        <Hot name="more" className="more">
          추가 정보
        </Hot>
      )}
      <div className="w-btns">
        {more && (
          <Hot name="run" className="w-btn">
            실행
          </Hot>
        )}
        <Hot name="dont-run" className="w-btn">
          실행 안 함
        </Hot>
      </div>
    </div>
  );
}

/** Windows ④: 작업 표시줄. ^를 누르면 숨겨진 아이콘 사이에 별 아이콘이 보인다. */
function WinDone({ phase }: { phase: string }) {
  /** 숨겨진 아이콘을 펼친 뒤인지. */
  const open = phase === 'open';
  return (
    <>
      {open && (
        <div className="w-fly">
          <span>
            <i className="g" />
          </span>
          <span>
            <i className="g" />
          </span>
          <span className="ex-found">
            <Star size={16} />
          </span>
        </div>
      )}
      <div className="w-task">
        <span className="mid">
          <i className="tb-ico start" />
          <i className="tb-ico" />
          <i className="tb-ico" />
        </span>
        <span className="r">
          {open ? (
            <span className="chev">⌃</span>
          ) : (
            <Hot name="chevron" className="chev">
              ⌃
            </Hot>
          )}
          <span>
            오후 3:12
            <br />
            2026-10-17
          </span>
        </span>
      </div>
    </>
  );
}

/** 장면의 바탕(macOS·Windows)과 놓는 위치. */
const SCENE_LOOK: Record<ExampleSceneId, string> = {
  'mac-dmg': 'mac',
  'mac-blocked': 'mac',
  'mac-settings': 'mac',
  'mac-confirm': 'mac',
  'mac-done': 'mac top',
  'win-sac': 'win',
  'win-smartscreen': 'win',
  'win-install': 'win',
  'win-done': 'win bottom',
};

/** 장면 하나의 지금 모습. */
function SceneBody({ scene, phase, reduced }: { scene: ExampleSceneId; phase: string; reduced: boolean }) {
  switch (scene) {
    case 'mac-dmg':
      return <MacDmg phase={phase} reduced={reduced} />;
    case 'mac-blocked':
      return <MacBlocked phase={phase} />;
    case 'mac-settings':
      return <MacSettings />;
    case 'mac-confirm':
      return <MacConfirm phase={phase} />;
    case 'mac-done':
      return <MacDone phase={phase} />;
    case 'win-sac':
      return <WinSmartAppControl phase={phase} />;
    case 'win-smartscreen':
      return <WinSmartScreen phase={phase} reduced={reduced} />;
    case 'win-install':
      return <WindowsInstaller reduced={reduced} />;
    case 'win-done':
      return <WinDone phase={phase} />;
  }
}

/** 예시 화면 장면이 받는 것. */
type Props = {
  /** 장면 이름. */
  scene: ExampleSceneId;
  /** 지금 상태. */
  state: ExampleState;
  /** 동작 줄이기가 켜져 있는지. 켜져 있으면 장면 전환과 옮겨 가는 모습 없이 마지막 모습만 그린다. */
  reduced: boolean;
  /** 장면 안의 버튼을 눌렀을 때. */
  onPress: (button: string) => void;
};

/** OS 창을 HTML로 재현한 예시 화면 장면. 모습이 바뀔 때마다 새로 그려 장면 전환을 보인다. */
export function ExampleScene({ scene, state, reduced, onPress }: Props) {
  return (
    <SceneControlsContext.Provider value={{ target: exampleTarget(scene, state), onPress }}>
      <div key={state.phase} className={`scene ${SCENE_LOOK[scene]}${reduced ? '' : ' enter'}`} data-scene={scene} data-phase={state.phase}>
        <SceneBody scene={scene} phase={state.phase} reduced={reduced} />
      </div>
    </SceneControlsContext.Provider>
  );
}

/** 예시 화면마다 모습별 안내 문구. */
export const SCENE_CAPTIONS: Record<ExampleSceneId, Record<string, ReactNode>> = {
  'mac-dmg': {
    start: (
      <>
        <b>Stardraft</b> 아이콘을 눌러 Applications 폴더로 옮겨 보세요. 실제로는 끌어다 놓습니다.
      </>
    ),
    moved: '옮겼습니다. 이제 응용 프로그램 폴더에서 엽니다.',
  },
  'mac-blocked': {
    start: (
      <>
        처음 열면 이 창이 뜹니다. <b>완료</b>를 누르세요.
      </>
    ),
    closed: '다시 받거나 설치할 필요는 없습니다. 다음 단계로 가세요.',
  },
  'mac-settings': {
    start: (
      <>
        <b>그래도 열기</b>를 누르세요.
      </>
    ),
    clicked: '확인 창이 하나 더 뜹니다. 다음 단계로 가세요.',
  },
  'mac-confirm': {
    start: (
      <>
        한 번 더 묻습니다. <b>그래도 열기</b>를 누르세요.
      </>
    ),
    password: (
      <>
        Mac 로그인 암호를 넣고 <b>설정 수정</b>을 누르세요.
      </>
    ),
    opened: 'Stardraft가 켜졌습니다. 다음부터는 바로 열립니다.',
  },
  'mac-done': {
    start: (
      <>
        알림을 허용할지 묻습니다. <b>허용</b>을 누르세요.
      </>
    ),
    allowed: '메뉴 막대의 별 아이콘이 Stardraft입니다. 설치 끝입니다.',
  },
  'win-sac': {
    start: (
      <>
        <b>앱 &amp; 브라우저 컨트롤</b>을 누르세요.
      </>
    ),
    'app-browser': (
      <>
        <b>스마트 앱 컨트롤 설정</b>을 누르세요.
      </>
    ),
    status: (
      <>
        지금 상태를 보세요. 이 그림은 <b>평가</b>입니다.
      </>
    ),
  },
  'win-smartscreen': {
    start: (
      <>
        <b>추가 정보</b>를 누르세요.
      </>
    ),
    more: (
      <>
        <b>실행</b>이 나타났습니다. 누르세요.
      </>
    ),
    installing: '설치가 시작됩니다.',
  },
  'win-install': {
    start: '설치는 저절로 진행됩니다. 끝나면 앱이 켜집니다.',
  },
  'win-done': {
    start: (
      <>
        <b>⌃</b>를 눌러 숨겨진 아이콘을 펼쳐 보세요.
      </>
    ),
    open: '별 아이콘이 Stardraft입니다. 설치 끝입니다.',
  },
};
