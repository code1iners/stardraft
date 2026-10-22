// 설치 안내의 단계 문구. 스펙 16절 "설치 안내"를 따른다. 넣지 않는 것: xattr 단계, 연락 절차, 스마트 앱 컨트롤을 끄라는 안내, 우클릭 > 열기.

import type { ReactNode } from 'react';
import type { ExampleSceneId } from '../lib/example-scenes';
import type { InstallerOs } from '../lib/releases';
import type { StuckScreenshotId } from '../lib/screenshots';

/** "여기서 막히면"의 항목 하나. */
export type StuckItem = {
  /** 겪는 일. */
  question: ReactNode;
  /** 할 일. */
  answer: ReactNode;
};

/** 스마트 앱 컨트롤 상태마다 할 일. */
export type SmartAppControlRow = {
  /** 설정 화면의 상태 이름. */
  state: string;
  /** 그 상태에서 할 일. */
  action: string;
};

/** 설치 단계 하나. */
export type InstallStep = {
  /** 단계 제목. */
  title: string;
  /** 이 단계에서 화면에 뜨는 문구("이 문구가 보이면"). */
  seen: string;
  /** 한두 문장의 지시. 누를 버튼 이름은 굵게. */
  body: ReactNode;
  /** 스마트 앱 컨트롤 상태별 표. 그 단계에만 있다. */
  states?: SmartAppControlRow[];
  /** 예시 화면 장면. */
  scene: ExampleSceneId;
  /** 막히는 곳이면 실제 스크린숏의 이름, 대체 글, 누를 곳 안내. */
  shot?: { id: StuckScreenshotId; alt: string; caption: ReactNode };
  /** 완료 기준(✓). */
  done: ReactNode;
  /** "여기서 막히면" 항목. 없으면 펼침도 없다. */
  stuck: StuckItem[];
};

/** 스마트 앱 컨트롤이 켜져 있을 때의 안내. */
const SMART_APP_CONTROL_ON = '스마트 앱 컨트롤이 켜져 있으면 Stardraft는 실행되지 않습니다.';

/** OS마다 설치 단계. macOS 5단계, Windows 4단계. */
export const INSTALL_STEPS: Record<InstallerOs, InstallStep[]> = {
  mac: [
    {
      title: 'DMG를 열고 응용 프로그램 폴더로 옮기기',
      seen: 'Applications',
      body: (
        <>
          <p>
            받은 DMG 파일을 엽니다. 뜨는 창에서 <b>Stardraft</b> 아이콘을 <b>Applications</b> 폴더로 끌어다 놓습니다.
          </p>
          <p>
            관리자가 아닌 계정이면 홈 폴더의 응용 프로그램 폴더(<code>~/Applications</code>)에 두세요.
          </p>
        </>
      ),
      scene: 'mac-dmg',
      done: '응용 프로그램 폴더에 Stardraft가 보이면 됩니다. DMG 창은 닫아도 됩니다.',
      stuck: [],
    },
    {
      title: '처음 열면 뜨는 창에서 완료 누르기',
      seen: '‘Stardraft’을(를) 열지 않음',
      body: (
        <p>
          응용 프로그램 폴더에서 Stardraft를 엽니다. 서명하지 않은 앱이라 macOS가 한 번 막고 이 창을 띄웁니다. <b>완료</b>를 눌러 닫으세요.{' '}
          <b>휴지통으로 이동</b>은 누르지 않습니다.
        </p>
      ),
      scene: 'mac-blocked',
      shot: {
        id: 'mac-blocked',
        alt: 'macOS의 ‘Stardraft’을(를) 열지 않음 창',
        caption: (
          <>
            <b>완료</b>를 누릅니다.
          </>
        ),
      },
      done: '창이 닫히면 다음 단계로 갑니다. 다시 받거나 설치할 필요는 없습니다.',
      stuck: [
        {
          question: '“손상되었기 때문에 열 수 없습니다”라고 떠요',
          answer: (
            <>
              받는 중에 파일이 깨졌거나 바뀌었을 수 있습니다. 이 파일은 지우고{' '}
              <a className="link" href="#download">
                사이트에서
              </a>{' '}
              다시 받으세요. 다시 받아도 같으면 설치하지 마세요.
            </>
          ),
        },
        {
          question: '휴지통으로 이동을 눌렀어요',
          answer: '휴지통에서 Stardraft를 응용 프로그램 폴더로 다시 꺼내고, 이 단계부터 다시 하세요.',
        },
        {
          question: 'Intel Mac에서 열리지 않아요',
          answer: (
            <>
              Stardraft는 Apple Silicon Mac에서만 실행됩니다. <b>Apple 메뉴 &gt; 이 Mac에 관하여</b>에 ‘프로세서’가 보이면 Intel Mac이고, ‘칩’이
              보이면 Apple Silicon입니다. Intel Mac용 파일은 없습니다.
            </>
          ),
        },
      ],
    },
    {
      title: '시스템 설정에서 그래도 열기 누르기',
      seen: '‘Stardraft’이(가) Mac을 보호하기 위해 차단되었습니다.',
      body: (
        <p>
          <b>시스템 설정</b> &gt; <b>개인정보 보호 및 보안</b>을 엽니다. 아래쪽 <b>보안</b> 항목에 Stardraft가 차단되었다는 줄이 있습니다. 그 옆의{' '}
          <b>그래도 열기</b>를 누릅니다.
        </p>
      ),
      scene: 'mac-settings',
      shot: {
        id: 'mac-settings',
        alt: 'macOS 시스템 설정의 개인정보 보호 및 보안에 있는 그래도 열기 버튼',
        caption: (
          <>
            <b>개인정보 보호 및 보안</b>의 <b>보안</b> 항목에서 <b>그래도 열기</b>를 누릅니다.
          </>
        ),
      },
      done: '확인 창이 하나 더 뜨면 다음 단계로 갑니다.',
      stuck: [
        {
          question: '그래도 열기 버튼이 안 보여요',
          answer: (
            <>
              이 버튼은 앱을 열려고 한 뒤 약 1시간 동안만 보입니다. 응용 프로그램 폴더에서 Stardraft를 한 번 더 열고, 뜨는 창에서 <b>완료</b>를
              누른 뒤 바로 돌아오세요.
            </>
          ),
        },
      ],
    },
    {
      title: '한 번 더 확인하고 암호 입력하기',
      seen: '‘Stardraft’을(를) 열겠습니까?',
      body: (
        <p>
          다시 뜨는 창에서 <b>그래도 열기</b>를 누르고, Mac 로그인 암호를 넣은 뒤 <b>설정 수정</b>을 누릅니다. 이 확인은 처음 한 번만 합니다.
        </p>
      ),
      scene: 'mac-confirm',
      done: 'Stardraft가 켜지면 됩니다. 다음부터는 바로 열립니다.',
      stuck: [],
    },
    {
      title: '메뉴 막대에 아이콘이 보이면 끝',
      seen: '‘Stardraft’ 알림',
      body: (
        <p>
          화면 오른쪽 위 메뉴 막대에 Stardraft 별 아이콘이 생깁니다. 처음 켜면 알림을 허용할지 묻습니다. 멘션이 오면 알려 드리도록 <b>허용</b>을
          누르세요.
        </p>
      ),
      scene: 'mac-done',
      done: '메뉴 막대의 별 아이콘을 누르면 Stardraft 창이 열립니다.',
      stuck: [
        {
          question: '메뉴 막대에 아이콘이 안 보여요',
          answer: '노치가 있는 MacBook에서는 메뉴 막대 아이콘이 많으면 일부가 노치 뒤로 가려집니다. 다른 메뉴 막대 아이콘 몇 개를 끄면 보입니다.',
        },
        {
          question: '알림 허용을 놓쳤어요',
          answer: (
            <>
              <b>시스템 설정</b> &gt; <b>알림</b> &gt; <b>Stardraft</b>에서 알림 허용을 켜세요.
            </>
          ),
        },
      ],
    },
  ],
  windows: [
    {
      title: '스마트 앱 컨트롤 확인하기 (Windows 11)',
      seen: '스마트 앱 컨트롤',
      body: (
        <p>
          시작 메뉴에서 <b>Windows 보안</b>을 열고 <b>앱 &amp; 브라우저 컨트롤</b> &gt; <b>스마트 앱 컨트롤 설정</b>으로 갑니다. 지금 상태를 봅니다.
          Windows 10에는 이 설정이 없으니 다음 단계로 바로 가세요.
        </p>
      ),
      states: [
        { state: '평가', action: '다음 단계로 갑니다.' },
        { state: '끄기', action: '다음 단계로 갑니다.' },
        { state: '켜기', action: SMART_APP_CONTROL_ON },
      ],
      scene: 'win-sac',
      shot: {
        id: 'win-sac',
        alt: 'Windows 보안의 스마트 앱 컨트롤 설정 화면',
        caption: '지금 상태를 확인합니다.',
      },
      done: '상태가 평가나 끄기이면 다음 단계로 갑니다.',
      stuck: [],
    },
    {
      title: '설치 파일을 열고 추가 정보 → 실행',
      seen: 'Windows의 PC 보호',
      body: (
        <p>
          받은 설치 파일을 엽니다. 파란 <b>Windows의 PC 보호</b> 창이 뜨는 것이 정상입니다. <b>추가 정보</b>를 누르면 아래에 <b>실행</b>이 나타납니다.{' '}
          <b>실행</b>을 누릅니다.
        </p>
      ),
      scene: 'win-smartscreen',
      shot: {
        id: 'win-smartscreen',
        alt: 'Windows의 PC 보호 창',
        caption: (
          <>
            <b>추가 정보</b>를 누르면 <b>실행</b>이 나타납니다.
          </>
        ),
      },
      done: '설치 창이 뜨면 됩니다.',
      stuck: [
        {
          question: '실행 버튼이 없어요',
          answer: (
            <>
              먼저 <b>추가 정보</b>를 눌렀는지 확인하세요. <b>실행</b>은 그다음에 나타납니다. 추가 정보를 눌러도 없으면 이 PC의 보안 설정이 실행을
              막고 있어 설치할 수 없습니다.
            </>
          ),
        },
        { question: '스마트 앱 컨트롤이 앱을 차단했다는 창이 떠요', answer: SMART_APP_CONTROL_ON },
      ],
    },
    {
      title: '묻는 것 없이 설치되고 켜집니다',
      seen: 'Stardraft 설치',
      body: <p>묻는 것 없이 내 계정에만 설치됩니다. 관리자 권한은 필요 없습니다. 설치가 끝나면 Stardraft가 바로 켜집니다.</p>,
      scene: 'win-install',
      done: '설치 창이 닫히고 Stardraft가 켜지면 됩니다.',
      stuck: [
        {
          question: '“Stardraft이(가) 실행 중입니다. OK을 클릭하면 종료됩니다.” 창이 떠요',
          answer: (
            <>
              이미 켜져 있는 Stardraft가 있어서 뜹니다. <b>OK</b>를 누르면 Stardraft를 끄고 설치를 이어 갑니다. 데이터는 그대로 남습니다.
            </>
          ),
        },
      ],
    },
    {
      title: '트레이에 아이콘이 보이면 끝',
      seen: '숨겨진 아이콘 표시',
      body: (
        <p>
          작업 표시줄 오른쪽 알림 영역에 Stardraft 별 아이콘이 생깁니다. 처음에는 <b>^</b>(숨겨진 아이콘 표시) 안에 들어가 있을 수 있습니다.
        </p>
      ),
      scene: 'win-done',
      done: '트레이의 별 아이콘을 누르면 Stardraft 창이 열립니다.',
      stuck: [
        {
          question: '트레이에 아이콘이 안 보여요',
          answer: (
            <>
              작업 표시줄 오른쪽의 <b>^</b>를 누르세요. 새로 설치한 앱의 아이콘은 처음에 그 안에 들어갑니다. 작업 표시줄 설정에서 항상 보이게 바꿀 수
              있습니다.
            </>
          ),
        },
      ],
    },
  ],
};
