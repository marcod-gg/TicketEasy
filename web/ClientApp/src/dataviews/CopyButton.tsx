import { useState } from 'react';

/** Botón pequeño "copiar al portapapeles" (ID en la tabla y en la tarjeta del tablero, nombre en Altas/Bajas). */
export function CopyButton({ text, what }: { text: string; what: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation(); // dentro de filas/tarjetas clicables no debe disparar nada más
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // http sin clipboard API: mismo respaldo que copyToClipboard de All.cshtml
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0;';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button type="button" className="dv-copy" title={copied ? 'Copiado' : `Copiar ${what}`} aria-label={`Copiar ${what} ${text}`} onClick={copy} draggable={false}>
      <i className={`fas fa-${copied ? 'check' : 'copy'}`} aria-hidden />
    </button>
  );
}
