import { useId, useState } from 'react';

/** 물음표 단추 툴팁에 넘기는 값. */
interface HelpTipProps {
  /** 무엇의 설명인지. 단추의 이름 "<이름> 설명"에 쓴다. */
  name: string;
  /** 펼칠 설명. */
  text: string;
}

/**
 * 이름 옆 물음표 단추와 그 아래로 펼치는 설명. 마우스를 올리거나 초점을 주면 보이고, 누르면 펼친 채로 둔다.
 * 설명은 늘 DOM에 두어 단추의 `aria-describedby`로 읽힌다.
 */
export function HelpTip({ name, text }: HelpTipProps) {
  /** 눌러서 펼쳐 두었는지 여부. */
  const [open, setOpen] = useState(false);
  /** 설명의 id. */
  const bodyId = useId();

  return (
    <span className="help-tip" data-open={open}>
      <button
        type="button"
        className="help-tip-button"
        aria-label={`${name} 설명`}
        aria-describedby={bodyId}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        onBlur={() => setOpen(false)}
      >
        ?
      </button>
      <span className="help-tip-body" role="tooltip" id={bodyId}>
        {text}
      </span>
    </span>
  );
}
