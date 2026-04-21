/**
 * DirtyChangesContext — central registry of unsaved edits across the page.
 *
 * Any editor can register an "entry" describing:
 *   - id (unique key)
 *   - label (what's dirty, shown in the floating bar tooltip)
 *   - hasChanges (live boolean)
 *   - save() / discard() callbacks
 *
 * The provider renders a single floating Save / Discard bar at the bottom of
 * the page whenever ANY registered entry reports `hasChanges = true`. Save
 * fires every dirty entry's save() in parallel; Discard fires every discard().
 */

import React, {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

interface Entry {
  id: string;
  label: string;
  hasChanges: boolean;
  save: () => Promise<boolean> | boolean | Promise<void> | void;
  discard: () => void;
}

interface ContextValue {
  register: (entry: Entry) => void;
  unregister: (id: string) => void;
}

const Ctx = createContext<ContextValue | null>(null);

interface ProviderProps {
  children: ReactNode;
}

export const DirtyChangesProvider: React.FC<ProviderProps> = ({ children }) => {
  const [entries, setEntries] = useState<Map<string, Entry>>(new Map());
  const [isSaving, setIsSaving] = useState(false);
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const register = useCallback((entry: Entry) => {
    setEntries(prev => {
      const existing = prev.get(entry.id);
      // Avoid pointless state updates if nothing changed
      if (
        existing &&
        existing.hasChanges === entry.hasChanges &&
        existing.label === entry.label &&
        existing.save === entry.save &&
        existing.discard === entry.discard
      ) {
        return prev;
      }
      const next = new Map(prev);
      next.set(entry.id, entry);
      return next;
    });
  }, []);

  const unregister = useCallback((id: string) => {
    setEntries(prev => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const ctx = useMemo(() => ({ register, unregister }), [register, unregister]);

  const dirty: Entry[] = [];
  entries.forEach(e => {
    if (e.hasChanges) dirty.push(e);
  });

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 2500);
    return () => clearTimeout(t);
  }, [flash]);

  const saveAll = async () => {
    if (dirty.length === 0 || isSaving) return;
    setIsSaving(true);
    try {
      const results = await Promise.all(
        dirty.map(async e => {
          try {
            const r = await e.save();
            return r !== false;
          } catch (err) {
            console.error(`[DirtyChanges] save failed for ${e.id}`, err);
            return false;
          }
        })
      );
      const ok = results.every(Boolean);
      setFlash({ kind: ok ? 'ok' : 'err', text: ok ? 'Saved' : 'Some changes failed to save' });
    } finally {
      setIsSaving(false);
    }
  };

  const discardAll = () => {
    if (dirty.length === 0) return;
    dirty.forEach(e => {
      try {
        e.discard();
      } catch (err) {
        console.error(`[DirtyChanges] discard failed for ${e.id}`, err);
      }
    });
  };

  const dirtyLabels = dirty.map(e => e.label).filter(Boolean);
  const summary =
    dirtyLabels.length === 1
      ? `Unsaved: ${dirtyLabels[0]}`
      : `${dirtyLabels.length} unsaved changes`;

  return (
    <Ctx.Provider value={ctx}>
      {children}

      {/* Floating bar */}
      <div
        className={`fixed bottom-0 left-0 right-0 transition-transform duration-200 z-40 ${
          dirty.length > 0 ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        <div className="bg-slate-950/95 backdrop-blur border-t border-emerald-700/40 shadow-2xl">
          <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
            <div
              className="text-slate-300 text-xs font-semibold truncate"
              title={dirtyLabels.join(', ')}
            >
              {isSaving ? 'Saving…' : summary}
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <button
                type="button"
                onClick={discardAll}
                disabled={isSaving}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-black uppercase tracking-wider transition-colors disabled:opacity-50"
              >
                Discard
              </button>
              <button
                type="button"
                onClick={saveAll}
                disabled={isSaving}
                className="px-5 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg text-xs font-black uppercase tracking-wider transition-colors disabled:opacity-50"
              >
                {isSaving ? 'Saving…' : `Save ${dirty.length > 1 ? 'all' : ''}`}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Flash toast */}
      {flash && (
        <div
          className={`fixed top-4 right-4 px-4 py-2.5 rounded-lg text-sm font-semibold shadow-2xl z-50 ${
            flash.kind === 'ok' ? 'bg-emerald-500 text-slate-950' : 'bg-red-500 text-white'
          }`}
        >
          {flash.text}
        </div>
      )}
    </Ctx.Provider>
  );
};

/**
 * Register an editor's dirty state + save/discard callbacks with the page-level bar.
 *
 * Pass stable strings for `id` and `label`; the callback identities don't matter
 * (we always invoke the latest via refs) so feel free to pass inline arrows.
 */
export function useRegisterDirty(
  id: string,
  label: string,
  hasChanges: boolean,
  save: () => Promise<boolean> | boolean | Promise<void> | void,
  discard: () => void
): void {
  const ctx = useContext(Ctx);
  if (!ctx) {
    // No provider — silently no-op so editors still work in isolation
    return;
  }

  const saveRef = useRef(save);
  const discardRef = useRef(discard);
  useEffect(() => {
    saveRef.current = save;
  }, [save]);
  useEffect(() => {
    discardRef.current = discard;
  }, [discard]);

  useEffect(() => {
    ctx.register({
      id,
      label,
      hasChanges,
      save: () => saveRef.current(),
      discard: () => discardRef.current(),
    });
    return () => ctx.unregister(id);
  }, [ctx, id, label, hasChanges]);
}
