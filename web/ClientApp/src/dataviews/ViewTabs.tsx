import { useState, type ReactNode } from 'react';
import { closePopover, Popover } from './Popover';
import { TYPE_ICON, TYPE_LABEL } from './useViews';
import type { ViewConfig, ViewType } from './types';

export function ViewTabs({ views, types, activeId, onSelect, onRename, onAdd, onDuplicate, onRemove, config, style }: {
  types: ViewType[];
  views: ViewConfig[];
  activeId: string;
  onSelect: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onAdd: (type: ViewType) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  /** Panel "Configuración" (diseños y herramientas); se abre dentro del menú "…". */
  config?: ReactNode;
  /** Panel "Estilo" de la vista activa; se abre dentro del menú "…". */
  style?: ReactNode;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [panel, setPanel] = useState<'config' | 'style' | null>(null);

  const commit = (id: string, name: string) => {
    if (name.trim()) onRename(id, name.trim());
    setEditing(null);
  };

  return (
    <div className="dv-tabs">
      <div className="dv-tabs__list" role="tablist" aria-label="Vistas guardadas">
        {views.map(v =>
          editing === v.id ? (
            <input
              key={v.id}
              className="dv-tabs__edit"
              defaultValue={v.name}
              aria-label="Nombre de la vista"
              autoFocus
              onFocus={e => e.target.select()}
              onBlur={e => commit(v.id, e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') commit(v.id, e.currentTarget.value);
                if (e.key === 'Escape') setEditing(null);
              }}
            />
          ) : (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={v.id === activeId}
              className={`dv-tab${v.id === activeId ? ' is-active' : ''}`}
              title="Doble clic para renombrar"
              onClick={() => onSelect(v.id)}
              onDoubleClick={() => setEditing(v.id)}
              onKeyDown={e => e.key === 'F2' && setEditing(v.id)}
            >
              <i className={`fas ${TYPE_ICON[v.type] ?? TYPE_ICON.table}`} aria-hidden /> {v.name}
            </button>
          ),
        )}
      </div>

      <Popover label={<><i className="fas fa-plus" aria-hidden /> Vista</>} className="dv-pop--menu">
        {types.map(t => (
          <button key={t} type="button" className="dv-menuitem" onClick={e => { onAdd(t); closePopover(e.currentTarget); }}>
            <i className={`fas ${TYPE_ICON[t]}`} aria-hidden /> {TYPE_LABEL[t]}
          </button>
        ))}
      </Popover>

      <Popover label={<i className="fas fa-ellipsis" aria-label="Acciones de la vista" />} className="dv-pop--menu" align="right"
        onToggle={open => { if (!open) setPanel(null); }}>
        {panel ? (
          <>
            <button type="button" className="dv-menuitem" onClick={() => setPanel(null)} autoFocus>
              <i className="fas fa-arrow-left" aria-hidden /> {panel === 'config' ? 'Configuración' : 'Estilo'}
            </button>
            {panel === 'config' ? config : style}
          </>
        ) : <>
        {config && (
          <button type="button" className="dv-menuitem" onClick={() => setPanel('config')}>
            <i className="fas fa-sliders" aria-hidden /> Configuración
          </button>
        )}
        {style && (
          <button type="button" className="dv-menuitem" onClick={() => setPanel('style')}>
            <i className="fas fa-palette" aria-hidden /> Estilo
          </button>
        )}
        <button type="button" className="dv-menuitem" onClick={e => { setEditing(activeId); closePopover(e.currentTarget); }}>
          <i className="fas fa-pen" aria-hidden /> Renombrar
        </button>
        <button type="button" className="dv-menuitem" onClick={e => { onDuplicate(activeId); closePopover(e.currentTarget); }}>
          <i className="fas fa-copy" aria-hidden /> Duplicar
        </button>
        <button
          type="button"
          className="dv-menuitem dv-menuitem--danger"
          disabled={views.length <= 1}
          title={views.length <= 1 ? 'Debe quedar al menos una vista' : undefined}
          onClick={e => { onRemove(activeId); closePopover(e.currentTarget); }}
        >
          <i className="fas fa-trash" aria-hidden /> Eliminar
        </button>
        </>}
      </Popover>
    </div>
  );
}
