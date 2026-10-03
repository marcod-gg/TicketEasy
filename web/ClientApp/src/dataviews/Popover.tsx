import { useEffect, useRef, type ReactNode } from 'react';

/** <details> nativo (teclado y aria gratis) + cierre al hacer clic fuera o con Escape. */
export function Popover({ label, children, className = '', align = 'left', onToggle }: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
  align?: 'left' | 'right';
  onToggle?: (open: boolean) => void;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: Event) => {
      const el = ref.current;
      if (!el?.open) return;
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !el.contains(e.target as Node)) {
        el.open = false;
        if (e instanceof KeyboardEvent) el.querySelector('summary')?.focus();
      }
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, []);
  return (
    <details ref={ref} className={`dv-pop ${className}`} onToggle={e => onToggle?.(e.currentTarget.open)}>
      <summary className="dv-btn">{label}</summary>
      <div className={`dv-pop__panel dv-pop__panel--${align}`}>{children}</div>
    </details>
  );
}

export const closePopover = (el: Element) => { const d = el.closest('details'); if (d) d.open = false; };
