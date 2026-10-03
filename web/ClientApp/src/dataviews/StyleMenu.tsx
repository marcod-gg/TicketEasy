import { useEffect, useState } from 'react';

/**
 * Herramienta "Estilo" (menú «…» de las pestañas): se guarda en cada vista (ViewConfig.style). Se aplica como
 * atributos sobre el contenedor .dv, así no tocan el resto de la app. Con el tema por defecto (default-theme, tokens --dt-*) el contenedor
 * lleva además su propio tema (.dt-thp + data-theme/data-contrast): claro, oscuro o "Sistema" = el tema de la propia web
 * (data-theme / data-bs-theme en <html>), seguido en vivo. Si la web no tiene tema, "Sistema" no está disponible y va claro.
 */
export interface StylePrefs {
  theme: 'system' | 'light' | 'dark';
  contrast: 'default' | 'high';
  striped: boolean; bold: boolean; lines: boolean; underline: boolean;
  density: 'compact' | 'normal' | 'comfortable';
  wrap: 'clip' | 'wrap';
  size: 'normal' | 'large' | 'xlarge';
  motion: 'normal' | 'reduce';
}

const FLAGS = [
  { k: 'striped', label: 'Filas alternadas', hint: 'Fondo en una fila sí y otra no' },
  { k: 'bold', label: 'Texto en negrita', hint: 'Celdas y tarjetas más gruesas' },
  { k: 'lines', label: 'Líneas entre columnas', hint: 'Separa las columnas de la tabla' },
  { k: 'underline', label: 'Subrayar enlaces', hint: 'Los títulos enlazados se distinguen sin color' },
] as const;

const CHOICES = [
  { k: 'density', label: 'Espacio entre filas', opts: [['compact', 'Compacto'], ['normal', 'Normal'], ['comfortable', 'Amplio']] },
  { k: 'wrap', label: 'Texto largo en celdas', opts: [['clip', 'Recortar'], ['wrap', 'Ajustar']] },
  { k: 'size', label: 'Tamaño del texto', opts: [['normal', 'Normal'], ['large', 'Grande'], ['xlarge', 'Muy grande']] },
  { k: 'motion', label: 'Animaciones', opts: [['normal', 'Normales'], ['reduce', 'Reducidas']] },
] as const;

export const STYLE_DEFAULTS: StylePrefs = {
  theme: 'system', contrast: 'default', striped: false, bold: false, lines: false, underline: false,
  density: 'normal', wrap: 'clip', size: 'normal', motion: 'normal',
};

/** Tema por defecto (default-theme) cargado: sus tokens permiten dar tema propio al espacio de trabajo. */
export const hasScopedThemes = () => getComputedStyle(document.documentElement).getPropertyValue('--dt-bg').trim() !== '';

/** Tema de la propia web: data-theme (default-theme u otro) o data-bs-theme (Bootstrap) en <html>; null si no tiene. */
export interface SiteTheme { theme: 'light' | 'dark'; vision: string; contrast: string }
const readSite = (): SiteTheme | null => {
  const h = document.documentElement;
  const t = h.getAttribute('data-theme') || h.getAttribute('data-bs-theme');
  if (t !== 'light' && t !== 'dark') return null;
  return { theme: t, vision: h.getAttribute('data-vision') || 'default', contrast: h.getAttribute('data-contrast') || 'default' };
};

/** Sigue el tema de la web en vivo: si la app lo cambia, el espacio de trabajo en "Sistema" cambia con ella. */
export function useSiteTheme(): SiteTheme | null {
  const [site, setSite] = useState(readSite);
  useEffect(() => {
    const mo = new MutationObserver(() => setSite(prev => { const n = readSite(); return JSON.stringify(n) === JSON.stringify(prev) ? prev : n; }));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-bs-theme', 'data-vision', 'data-contrast'] });
    return () => mo.disconnect();
  }, []);
  return site;
}

/** Atributos del contenedor .dv: lectura (data-tb-*) y, con default-theme, su tema (el de la web en "Sistema"; sin tema en la web, claro). */
export function styleAttrs(p: StylePrefs, site: SiteTheme | null, themed: boolean): Record<string, string | undefined> {
  const a: Record<string, string | undefined> = {};
  for (const { k } of FLAGS) a[`data-tb-${k}`] = p[k] ? 'on' : undefined;
  for (const { k } of CHOICES) a[`data-tb-${k}`] = p[k];
  if (!themed) return a;
  const follow = p.theme === 'system' && site;
  return Object.assign(a, {
    'data-theme': follow ? site.theme : p.theme === 'dark' ? 'dark' : 'light',
    'data-vision': follow ? site.vision : 'default',
    'data-contrast': p.contrast === 'high' || (follow && site.contrast === 'high') ? 'high' : 'default',
  });
}

/** Animaciones apagadas: por el sistema (prefers-reduced-motion) o por la herramienta Estilo de ese espacio de trabajo. */
export const reduceMotion = (el?: Element | null) =>
  !!el?.closest('[data-tb-motion="reduce"]') || !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function StyleMenu({ prefs, onChange, themed, site }: { prefs: StylePrefs; onChange: (p: StylePrefs) => void; themed: boolean; site: SiteTheme | null }) {
  const set = (patch: Partial<StylePrefs>) => onChange({ ...prefs, ...patch });
  // "Sistema" sin tema en la web: bloqueado y se muestra claro.
  const theme = prefs.theme === 'system' && !site ? 'light' : prefs.theme;
  const radios = (name: string, opts: readonly (readonly [string, string])[], value: string, onPick: (v: string) => void, off?: string, offNote?: string) => (
    <div className="dv-style__seg" role="radiogroup" aria-label={name}>
      {opts.map(([v, l]) => (
        <label key={v} className={`${value === v ? 'is-active' : ''}${off === v ? ' is-off' : ''}`} title={off === v ? offNote : undefined}>
          <input type="radio" name={`dv-style-${name}`} value={v} checked={value === v} disabled={off === v} onChange={() => onPick(v)} />
          {l}{off === v && <small>No disponible</small>}
        </label>
      ))}
    </div>
  );
  return (
    <div className="dv-editor dv-style">
      <p className="dv-muted dv-style__note">Solo cambia esta vista; las demás conservan su propio estilo.</p>
      {themed && <>
        <b>Apariencia</b>
        {radios('Tema', [['system', 'Sistema'], ['light', 'Claro'], ['dark', 'Oscuro']], theme, v => set({ theme: v as StylePrefs['theme'] }),
          site ? undefined : 'system', 'La página no tiene tema claro/oscuro propio')}
        {theme === 'system' && site && <span className="dv-muted dv-style__note">Sigue el tema de la página ({site.theme === 'dark' ? 'oscuro' : 'claro'}).</span>}
        <label className="dv-check">
          <input type="checkbox" checked={prefs.contrast === 'high'} onChange={e => set({ contrast: e.target.checked ? 'high' : 'default' })} />
          Alto contraste <span className="dv-muted">(texto y bordes a 7:1)</span>
        </label>
      </>}
      <b>Lectura</b>
      {FLAGS.map(f => (
        <label key={f.k} className="dv-check" title={f.hint}>
          <input type="checkbox" checked={prefs[f.k]} onChange={e => set({ [f.k]: e.target.checked })} />{f.label}
        </label>
      ))}
      {CHOICES.map(c => (
        <div key={c.k} className="dv-style__row">
          <span className="dv-style__label">{c.label}</span>
          {radios(c.label, c.opts, prefs[c.k], v => set({ [c.k]: v } as Partial<StylePrefs>))}
        </div>
      ))}
      <button type="button" className="dv-link" onClick={() => onChange(STYLE_DEFAULTS)}>Restablecer estilo</button>
    </div>
  );
}
