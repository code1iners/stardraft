/** 키체인 항목 이름. 앱 이름 뒤에 Safe Storage가 붙는다. */
const KEYCHAIN_ITEM = 'Stardraft Safe Storage';

/**
 * 업데이트 뒤 다시 켜지면 macOS가 띄우는 키체인 대화상자의 예시 화면.
 * 앱의 다시 시작 확인 화면(데스크톱 `UpdatePrompts.tsx`의 `RestartConfirm`)과 같은 문구·버튼·강조를 쓴다. 한쪽을 바꾸면 다른 쪽도 맞춘다.
 */
export function KeychainExample() {
  return (
    <figure className="example keychain-example">
      <figcaption className="example-band">예시 화면 · 실제 창이 아닙니다</figcaption>
      <div className="example-stage">
        <div className="keychain-dialog" aria-hidden="true">
          <p className="keychain-text">{`Stardraft이(가) 사용자의 키체인에 있는 기밀 정보 '${KEYCHAIN_ITEM}'을(를) 사용하려고 합니다.`}</p>
          <p className="keychain-text">허용하려면 '로그인' 키체인 암호를 입력하십시오.</p>
          <div className="keychain-field">
            <span>암호:</span>
            <span className="keychain-input" />
          </div>
          <div className="keychain-buttons">
            <span className="keychain-btn emphasized">항상 허용</span>
            <span className="keychain-btn">거부</span>
            <span className="keychain-btn">허용</span>
          </div>
        </div>
      </div>
    </figure>
  );
}
