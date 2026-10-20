import { type MouseEvent, useEffect, useRef, useState } from 'react';

/** Selection follows queue IDs, never a row's changing position. The rail remounts per account/room. */
export function useQueueSelection(ids: string[]) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const anchor = useRef<string | undefined>(undefined);
  const order = ids.join(',');
  useEffect(() => {
    const present = new Set(ids);
    setSelected(current => [...current].some(id => !present.has(id)) ? new Set([...current].filter(id => present.has(id))) : current);
    if (anchor.current && !present.has(anchor.current)) anchor.current = undefined;
  }, [order]);
  const toggle = (id: string) => {
    anchor.current = id;
    setSelected(current => { const next = new Set(current); if (!next.delete(id)) next.add(id); return next; });
  };
  return {
    selected,
    toggle,
    clear: () => setSelected(new Set()),
    selectAll: () => { anchor.current = ids[0]; setSelected(new Set(ids)); },
    remove: (id: string) => setSelected(current => { const next = new Set(current); next.delete(id); return next; }),
    click: (event: MouseEvent, id: string) => {
      // React bubbles portal menu events through the row's component tree.
      if (!(event.target instanceof Element) || !event.currentTarget.contains(event.target) || event.target.closest('button, a, input')) return;
      if (event.shiftKey) {
        event.preventDefault();
        const start = Math.max(0, ids.indexOf(anchor.current || id));
        const end = ids.indexOf(id);
        if (end < 0) return;
        setSelected(current => new Set([...(event.ctrlKey || event.metaKey ? current : []), ...ids.slice(Math.min(start, end), Math.max(start, end) + 1)]));
        anchor.current ||= id;
      } else if (event.ctrlKey || event.metaKey || selected.size) {
        event.preventDefault();
        toggle(id);
      } else anchor.current = id;
    },
  };
}
