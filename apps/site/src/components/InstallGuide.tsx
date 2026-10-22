import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { onInstallOsChosen } from '../lib/install-os';
import { INSTALLER_OS_NAMES, INSTALLER_OSES, type InstallerOs } from '../lib/releases';
import { stuckScreenshot } from '../lib/screenshots';
import { readVisitor, visitorOs } from '../lib/visitor';
import { ExampleFrame } from './ExampleFrame';
import { INSTALL_STEPS, type InstallStep } from './install-steps';

/** 막히는 곳의 실제 스크린숏이 하나라도 들어갔는지. */
const HAS_SCREENSHOTS = INSTALLER_OSES.some((os) => INSTALL_STEPS[os].some((step) => step.shot && stuckScreenshot(step.shot.id)));

/** 완료 기준 앞의 체크 표시. */
function CheckMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 단계 하나: 제목, 화면 문구, 지시, 상태별 표, 예시 화면, 완료 기준, "여기서 막히면". */
function Step({ step, number }: { step: InstallStep; number: number }) {
  /** 막히는 곳의 실제 스크린숏. */
  const shot = step.shot && { image: stuckScreenshot(step.shot.id), alt: step.shot.alt, caption: step.shot.caption };
  return (
    <li>
      <span className="num" aria-hidden="true">
        {number}
      </span>
      <div>
        <h3>{step.title}</h3>
        <p className="quote-line">
          이 문구가 보이면: <q>{step.seen}</q>
        </p>
        {step.body}
        {step.states && (
          <table className="states">
            <thead>
              <tr>
                <th>지금 상태</th>
                <th>할 일</th>
              </tr>
            </thead>
            <tbody>
              {step.states.map(({ state, action }) => (
                <tr key={state}>
                  <td>
                    <b>{state}</b>
                  </td>
                  <td>{action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <ExampleFrame scene={step.scene} shot={shot} />
        <p className="check">
          <CheckMark />
          <span>{step.done}</span>
        </p>
        {step.stuck.length > 0 && (
          <details className="stuck">
            <summary>여기서 막히면</summary>
            <dl className="qa">
              {step.stuck.map(({ question, answer }, index) => (
                <div key={index}>
                  <dt>{question}</dt>
                  <dd>{answer}</dd>
                </div>
              ))}
            </dl>
          </details>
        )}
      </div>
    </li>
  );
}

/**
 * 설치 안내 섹션의 OS 탭과 단계. 탭의 기본값은 감지한 OS이고, 첫 화면에서 다른 OS용으로 받으면 탭도 그 OS로 바뀐다.
 * 두 OS의 단계를 모두 그려 두고 고른 탭만 보인다. 탭을 오가도 예시 화면의 진행이 남는다.
 */
export function InstallGuide() {
  /** 고른 OS 탭. 빌드한 HTML과 감지 전에는 macOS이고, 브라우저에서 감지한 OS로 바뀐다. */
  const [os, setOs] = useState<InstallerOs>('mac');
  /** 사용자가 탭이나 다운로드 링크로 OS를 골랐는지. 고른 뒤에는 늦게 끝난 감지가 탭을 바꾸지 않는다. */
  const chosenRef = useRef(false);
  /** 탭 버튼. 화살표 키로 옮길 때 초점을 준다. */
  const tabRefs = useRef<Record<InstallerOs, HTMLButtonElement | null>>({ mac: null, windows: null });

  /** 사용자가 OS를 고른다. */
  const choose = useCallback((next: InstallerOs) => {
    chosenRef.current = true;
    setOs(next);
  }, []);

  useEffect(function selectDetectedOs() {
    /** 화면을 떠난 뒤 늦게 끝난 감지를 버린다. */
    let active = true;
    readVisitor(navigator).then((visitor) => {
      /** 감지한 방문 환경이 받을 OS. */
      const detected = visitorOs(visitor);
      if (active && detected && !chosenRef.current) setOs(detected);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(
    function followDownloadChoice() {
      return onInstallOsChosen(choose);
    },
    [choose],
  );

  /** 왼쪽·오른쪽 화살표로 이전·다음 탭으로 옮긴다. 끝에서는 반대쪽 끝으로 돈다. */
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    /** 옮길 칸 수. */
    const step = event.key === 'ArrowRight' ? 1 : -1;
    /** 옮겨 갈 탭. */
    const next = INSTALLER_OSES[(INSTALLER_OSES.indexOf(os) + step + INSTALLER_OSES.length) % INSTALLER_OSES.length]!;
    choose(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <div className="install-guide">
      <div className="tabs" role="tablist" aria-label="설치할 OS" onKeyDown={handleKeyDown}>
        {INSTALLER_OSES.map((tab) => (
          <button
            key={tab}
            ref={(element) => {
              tabRefs.current[tab] = element;
            }}
            type="button"
            role="tab"
            id={`install-tab-${tab}`}
            className="tab"
            aria-selected={tab === os}
            aria-controls={`install-panel-${tab}`}
            tabIndex={tab === os ? 0 : -1}
            onClick={() => choose(tab)}
          >
            {INSTALLER_OS_NAMES[tab]}
          </button>
        ))}
      </div>
      <p className="muted small">
        단계마다 예시 화면을 눌러 볼 수 있습니다.
        {HAS_SCREENSHOTS && (
          <>
            {' '}
            막히기 쉬운 화면은 실제 화면을 먼저 보이고, <b>예시</b>로 바꾸면 눌러 볼 수 있습니다.
          </>
        )}
      </p>
      {INSTALLER_OSES.map((tab) => (
        <div key={tab} role="tabpanel" id={`install-panel-${tab}`} aria-labelledby={`install-tab-${tab}`} hidden={tab !== os}>
          <ol className="steps">
            {INSTALL_STEPS[tab].map((step, index) => (
              <Step key={step.title} step={step} number={index + 1} />
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}
