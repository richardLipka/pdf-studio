import { useEffect, useRef } from 'react';

/** Calls onEscape when Escape is pressed while `active` (dialogs close with Esc) */
export const useEscapeKey = (active: boolean, onEscape: () => void) => {
  const handlerRef = useRef(onEscape);
  handlerRef.current = onEscape;

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      handlerRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active]);
};
