import { useEffect, useState } from 'react';

/** 복사 결과를 버튼 글에 보여 주는 시간(ms). */
const FEEDBACK_MS = 2000;

type Props = {
  /** 복사할 글. */
  text: string;
  /** 버튼 글. */
  label?: string;
  /** 버튼 모양. `link`는 글 사이에 넣는 링크 모양, `small`은 표·경로 옆의 작은 버튼, `primary`는 대표 버튼. */
  look?: 'link' | 'small' | 'primary';
};

/** 누르면 글을 클립보드에 복사하고 잠깐 결과를 보여 주는 버튼. */
export function CopyButton({ text, label = '복사', look = 'small' }: Props) {
  /** 마지막 복사 결과. 잠시 뒤 idle로 돌아간다. */
  const [result, setResult] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(
    function resetFeedbackLater() {
      if (result === 'idle') return;
      const timer = setTimeout(() => setResult('idle'), FEEDBACK_MS);
      return () => clearTimeout(timer);
    },
    [result],
  );

  /** 클립보드에 쓴다. 권한이 없거나 보안 맥락이 아니면 실패를 보인다. */
  const handleClick = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setResult('copied');
    } catch {
      setResult('failed');
    }
  };

  /** 모양별 class. */
  const className = look === 'link' ? 'link' : look === 'primary' ? 'btn primary lg' : 'btn sm';
  return (
    <button type="button" className={className} onClick={handleClick}>
      {result === 'copied' ? '복사했습니다' : result === 'failed' ? '복사하지 못했습니다' : label}
    </button>
  );
}
