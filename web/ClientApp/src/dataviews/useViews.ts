import { useCallback, useEffect, useState } from 'react';
import type { ViewConfig, ViewType } from './types';

export const newId = () => Math.random().toString(36).slice(2, 10); // crypto.randomUUID exige https

export const TYPE_LABEL: Record<ViewType, string> = { table: 'Tabla', board: 'Tablero', cards: 'Tarjetas' };
export const TYPE_ICON: Record<ViewType, string> = { table: 'fa-table', board: 'fa-table-columns', cards: 'fa-table-cells-large' };

export function blankView(type: ViewType, source: string, name = TYPE_LABEL[type]): ViewConfig {
  return { id: newId(), name, type, source, filters: [], groupBy: '', sorting: [], hidden: {}, search: '' };
}

interface Stored {
  views: ViewConfig[];
  activeId: string;
}

function load(key: string, defaults: () => ViewConfig[]): Stored {
  try {
    const s = JSON.parse(localStorage.getItem(key) ?? 'null') as Stored | null;
    if (s?.views?.length) return s;
  } catch {
    /* storage bloqueado o JSON corrupto → defaults */
  }
  const views = defaults();
  return { views, activeId: views[0].id };
}

// ponytail: localStorage por navegador; si se necesitan vistas compartidas entre equipos, cambiar load/save por un endpoint.
export function useViews(storageKey: string, defaults: () => ViewConfig[]) {
  const [state, setState] = useState(() => load(storageKey, defaults));

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(state));
      } catch {
        /* sin storage: las vistas duran lo que la pestaña */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [storageKey, state]);

  const active = state.views.find(v => v.id === state.activeId) ?? state.views[0];

  const setActive = useCallback((activeId: string) => setState(s => ({ ...s, activeId })), []);

  const update = useCallback(
    (id: string, patch: Partial<ViewConfig>) =>
      setState(s => ({ ...s, views: s.views.map(v => (v.id === id ? { ...v, ...patch } : v)) })),
    [],
  );

  const add = useCallback((type: ViewType, source: string, name?: string) => {
    const v = blankView(type, source, name);
    setState(s => ({ views: [...s.views, v], activeId: v.id }));
  }, []);

  const duplicate = useCallback(
    (id: string) =>
      setState(s => {
        const src = s.views.find(v => v.id === id);
        if (!src) return s;
        const copy: ViewConfig = { ...structuredClone(src), id: newId(), name: src.name + ' (copia)' };
        const i = s.views.indexOf(src);
        return { views: [...s.views.slice(0, i + 1), copy, ...s.views.slice(i + 1)], activeId: copy.id };
      }),
    [],
  );

  const remove = useCallback(
    (id: string) =>
      setState(s => {
        if (s.views.length <= 1) return s;
        const views = s.views.filter(v => v.id !== id);
        return { views, activeId: s.activeId === id ? views[0].id : s.activeId };
      }),
    [],
  );

  return { views: state.views, active, setActive, update, add, duplicate, remove };
}
