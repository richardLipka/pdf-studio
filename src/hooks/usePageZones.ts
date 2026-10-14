import { RefObject, useCallback, useEffect, useRef, useState } from 'react';

/**
 * Distance of a page from the visible part of the scroll container:
 * - near: on screen or within 1.5 screen heights; rendered (canvas, text layer, edit overlays)
 * - keep: within 5 screen heights; whatever is drawn stays, nothing new is rendered
 * - far:  further away; bitmaps and text layers are released
 * Only the pages around the viewport hold memory, so a document's size no longer decides how much
 * memory the viewer needs (all pages used to be rendered and kept).
 */
export type PageZone = 'near' | 'keep' | 'far';

const NEAR_MARGIN = '150% 0px 150% 0px';
const KEEP_MARGIN = '500% 0px 500% 0px';

/** Page elements carry data-page-id; `pageIds` (in document order) re-registers them when pages change */
export const usePageZones = (rootRef: RefObject<HTMLElement | null>, pageIds: string[]) => {
  const [near, setNear] = useState<ReadonlySet<string>>(() => new Set());
  const [keep, setKeep] = useState<ReadonlySet<string>>(() => new Set());
  const visibleRef = useRef<Set<string>>(new Set());
  const idsKey = pageIds.join('|');

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (typeof IntersectionObserver === 'undefined') {
      // No observer (tests, very old engines): treat every page as near
      const all = new Set(pageIds);
      setNear(all);
      setKeep(all);
      return;
    }

    const track = (setter: (update: (prev: ReadonlySet<string>) => ReadonlySet<string>) => void) => (entries: IntersectionObserverEntry[]) =>
      setter((prev) => {
        let next: Set<string> | null = null;
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.pageId;
          if (!id || entry.isIntersecting === prev.has(id)) continue;
          next ??= new Set(prev);
          if (entry.isIntersecting) next.add(id);
          else next.delete(id);
        }
        return next ?? prev;
      });

    const nearObserver = new IntersectionObserver(track(setNear), { root, rootMargin: NEAR_MARGIN });
    const keepObserver = new IntersectionObserver(track(setKeep), { root, rootMargin: KEEP_MARGIN });
    const visibleObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.pageId;
          if (!id) continue;
          if (entry.isIntersecting) visibleRef.current.add(id);
          else visibleRef.current.delete(id);
        }
      },
      { root }
    );
    const elements = root.querySelectorAll<HTMLElement>('[data-page-id]');
    elements.forEach((el) => {
      nearObserver.observe(el);
      keepObserver.observe(el);
      visibleObserver.observe(el);
    });
    return () => {
      nearObserver.disconnect();
      keepObserver.disconnect();
      visibleObserver.disconnect();
    };
    // Re-register when the set or order of pages changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootRef, idsKey]);

  const zoneOf = useCallback(
    (id: string): PageZone => (near.has(id) ? 'near' : keep.has(id) ? 'keep' : 'far'),
    [near, keep]
  );

  /** Ids of the pages currently intersecting the scroll container */
  const visibleIds = useCallback(() => visibleRef.current, []);

  return { zoneOf, visibleIds };
};

/** Device pixel ratio for crisp canvases (capped at 2 to bound memory); follows monitor changes */
export const useCanvasPixelRatio = (): number => {
  const read = () => (typeof window === 'undefined' ? 1 : Math.min(2, Math.max(1, window.devicePixelRatio || 1)));
  const [ratio, setRatio] = useState(read);
  useEffect(() => {
    const update = () => setRatio(read());
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return ratio;
};
