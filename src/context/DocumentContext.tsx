import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { PdfPageModel, SourceDocument } from '../types/document';
import { Annotation } from '../types/annotations';
import { exportEditedPdf } from '../services/pdfExporter';
import { deletePage, reorderPages, rotatePage, insertPagesAtPosition, InsertPosition } from '../services/pageManager';
import { parsePdfPages, extractPdfAnnotations, clearPdfCache } from '../services/pdfLoader';

interface HistorySnapshot {
  pages: PdfPageModel[];
  annotations: Annotation[];
  activePageIndex: number;
}

const MAX_HISTORY = 100; // Generous 100-step undo/redo stack

interface DocumentContextType {
  fileName: string;
  setFileName: (name: string) => void;
  sources: SourceDocument[];
  pages: PdfPageModel[];
  activePageIndex: number;
  selectedPageIds: string[];
  annotations: Annotation[];
  selectedAnnotationId: string | null;
  scale: number;
  isSaving: boolean;
  canUndo: boolean;
  canRedo: boolean;
  historyLength: number;
  historyIndex: number;
  
  // Document Operations
  loadPdfFile: (file: File) => Promise<void>;
  loadSamplePdf: (buffer: ArrayBuffer, lang: string) => Promise<void>;
  setActivePageIndex: (index: number) => void;
  setScale: (scale: number | ((prev: number) => number)) => void;
  zoomToFitPage: (pageIndex?: number) => void;
  zoomToFitWidth: (pageIndex?: number) => void;
  
  // Multi-Page Selection & Navigation Operations
  setSelectedPageIds: (ids: string[]) => void;
  togglePageSelection: (pageId: string, isMulti: boolean, isRange: boolean) => void;
  navigatePage: (delta: number, isShift: boolean) => void;
  selectRangeToStart: () => void;
  selectRangeToEnd: () => void;
  selectAllPages: () => void;
  clearPageSelection: () => void;
  
  // Page Operations
  rotatePageById: (pageId: string, deltaAngle: number) => void;
  rotateSelectedPages: (deltaAngle: number) => void;
  deletePageById: (pageId: string) => void;
  deleteSelectedPages: () => void;
  reorderPagesByIndex: (fromIndex: number, toIndex: number) => void;
  insertPages: (newPages: PdfPageModel[], position: InsertPosition, newSource?: SourceDocument) => void;
  
  // Annotation Operations
  addAnnotation: (annotation: Annotation) => void;
  updateAnnotation: (annotation: Annotation, recordHistory?: boolean) => void;
  deleteAnnotation: (id: string) => void;
  setSelectedAnnotationId: (id: string | null) => void;
  
  // Undo / Redo / Export
  undo: () => void;
  redo: () => void;
  commitHistorySnapshot: () => void;
  saveAndDownload: (customName?: string) => Promise<void>;
}

const DocumentContext = createContext<DocumentContextType | null>(null);

// Deep clone helper for immutable history snapshots
const deepClone = <T,>(obj: T): T => {
  return JSON.parse(JSON.stringify(obj));
};

export const DocumentProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [fileName, setFileName] = useState<string>('document.pdf');
  const [sources, setSources] = useState<SourceDocument[]>([]);
  const [pages, setPages] = useState<PdfPageModel[]>([]);
  const [activePageIndex, setActivePageIndex] = useState<number>(0);
  const [selectedPageIds, setSelectedPageIds] = useState<string[]>([]);
  const [lastSelectedPageId, setLastSelectedPageId] = useState<string | null>(null);
  const rangeAnchorIndexRef = useRef<number>(0);
  
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [scale, setScale] = useState<number>(1.2);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // Undo / Redo history stack
  const [history, setHistory] = useState<HistorySnapshot[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);

  const pushHistory = useCallback(
    (newPages: PdfPageModel[], newAnnotations: Annotation[], newActiveIndex: number) => {
      setHistory((prev) => {
        const next = prev.slice(0, historyIndex + 1);
        const snapshot: HistorySnapshot = {
          pages: deepClone(newPages),
          annotations: deepClone(newAnnotations),
          activePageIndex: newActiveIndex,
        };

        if (next.length >= MAX_HISTORY) {
          next.shift();
        }
        return [...next, snapshot];
      });
      setHistoryIndex((prev) => Math.min(prev + 1, MAX_HISTORY - 1));
    },
    [historyIndex]
  );

  const commitHistorySnapshot = useCallback(() => {
    pushHistory(pages, annotations, activePageIndex);
  }, [pages, annotations, activePageIndex, pushHistory]);

  const loadPdfFile = async (file: File) => {
    try {
      const buffer = await file.arrayBuffer();
      clearPdfCache();
      const mainSource: SourceDocument = {
        id: 'main',
        name: file.name,
        arrayBuffer: buffer,
      };

      const parsedPages = await parsePdfPages(buffer, 'main');
      const loadedAnnotations = await extractPdfAnnotations(buffer, 'main', parsedPages);
      setFileName(file.name);
      setSources([mainSource]);
      setPages(parsedPages);
      setActivePageIndex(0);
      rangeAnchorIndexRef.current = 0;
      setSelectedPageIds(parsedPages.length > 0 ? [parsedPages[0].id] : []);
      setLastSelectedPageId(parsedPages.length > 0 ? parsedPages[0].id : null);
      setAnnotations(loadedAnnotations);
      setSelectedAnnotationId(null);

      // Initialize history
      setHistory([{
        pages: deepClone(parsedPages),
        annotations: deepClone(loadedAnnotations),
        activePageIndex: 0,
      }]);
      setHistoryIndex(0);
    } catch (e) {
      console.error('Failed to load PDF file:', e);
      throw e;
    }
  };

  const loadSamplePdf = async (buffer: ArrayBuffer, _lang: string) => {
    clearPdfCache();
    const mainSource: SourceDocument = {
      id: 'main',
      name: 'sample-contract.pdf',
      arrayBuffer: buffer,
    };

    const parsedPages = await parsePdfPages(buffer, 'main');
    const loadedAnnotations = await extractPdfAnnotations(buffer, 'main', parsedPages);
    setFileName('sample-contract.pdf');
    setSources([mainSource]);
    setPages(parsedPages);
    setActivePageIndex(0);
    rangeAnchorIndexRef.current = 0;
    setSelectedPageIds(parsedPages.length > 0 ? [parsedPages[0].id] : []);
    setLastSelectedPageId(parsedPages.length > 0 ? parsedPages[0].id : null);
    setAnnotations(loadedAnnotations);
    setSelectedAnnotationId(null);

    setHistory([{
      pages: deepClone(parsedPages),
      annotations: deepClone(loadedAnnotations),
      activePageIndex: 0,
    }]);
    setHistoryIndex(0);
  };

  // Zoom Operations
  const zoomToFitPage = (pageIndex?: number) => {
    const targetIdx = pageIndex !== undefined ? pageIndex : activePageIndex;
    const targetPage = pages[targetIdx] || pages[0];
    if (!targetPage) return;

    const availWidth = Math.max(300, window.innerWidth - 256 - 64);
    const availHeight = Math.max(300, window.innerHeight - 144 - 64);

    const scaleX = availWidth / targetPage.width;
    const scaleY = availHeight / targetPage.height;
    const targetScale = Math.max(0.4, Math.min(2.5, Number(Math.min(scaleX, scaleY).toFixed(2))));

    setScale(targetScale);
    setActivePageIndex(targetIdx);
  };

  const zoomToFitWidth = (pageIndex?: number) => {
    const targetIdx = pageIndex !== undefined ? pageIndex : activePageIndex;
    const targetPage = pages[targetIdx] || pages[0];
    if (!targetPage) return;

    const availWidth = Math.max(300, window.innerWidth - 256 - 64);
    const targetScale = Math.max(0.4, Math.min(3.0, Number((availWidth / targetPage.width).toFixed(2))));

    setScale(targetScale);
    setActivePageIndex(targetIdx);
  };

  // Multi-Page Selection Logic
  const togglePageSelection = (pageId: string, isMulti: boolean, isRange: boolean) => {
    const clickedIdx = pages.findIndex((p) => p.id === pageId);
    if (clickedIdx === -1) return;

    setActivePageIndex(clickedIdx);

    if (isRange && lastSelectedPageId) {
      const lastIdx = pages.findIndex((p) => p.id === lastSelectedPageId);
      if (lastIdx !== -1) {
        const start = Math.min(clickedIdx, lastIdx);
        const end = Math.max(clickedIdx, lastIdx);
        const rangeIds = pages.slice(start, end + 1).map((p) => p.id);
        
        if (isMulti) {
          const union = Array.from(new Set([...selectedPageIds, ...rangeIds]));
          setSelectedPageIds(union);
        } else {
          setSelectedPageIds(rangeIds);
        }
        return;
      }
    }

    if (isMulti) {
      // Toggle individual page in selection
      if (selectedPageIds.includes(pageId)) {
        if (selectedPageIds.length > 1) {
          setSelectedPageIds(selectedPageIds.filter((id) => id !== pageId));
        }
      } else {
        setSelectedPageIds([...selectedPageIds, pageId]);
      }
      setLastSelectedPageId(pageId);
      rangeAnchorIndexRef.current = clickedIdx;
    } else {
      // Single selection
      setSelectedPageIds([pageId]);
      setLastSelectedPageId(pageId);
      rangeAnchorIndexRef.current = clickedIdx;
    }
  };

  // Keyboard Arrow Navigation
  const navigatePage = (delta: number, isShift: boolean) => {
    if (pages.length === 0) return;
    const nextIndex = Math.max(0, Math.min(pages.length - 1, activePageIndex + delta));
    if (nextIndex === activePageIndex && !isShift) return;

    setActivePageIndex(nextIndex);

    if (isShift) {
      const anchor = rangeAnchorIndexRef.current;
      const start = Math.min(anchor, nextIndex);
      const end = Math.max(anchor, nextIndex);
      const rangeIds = pages.slice(start, end + 1).map((p) => p.id);
      setSelectedPageIds(rangeIds);
      setLastSelectedPageId(pages[nextIndex].id);
    } else {
      rangeAnchorIndexRef.current = nextIndex;
      setSelectedPageIds([pages[nextIndex].id]);
      setLastSelectedPageId(pages[nextIndex].id);
    }
  };

  const selectRangeToStart = () => {
    const endIdx = activePageIndex;
    const rangeIds = pages.slice(0, endIdx + 1).map((p) => p.id);
    setSelectedPageIds(rangeIds);
  };

  const selectRangeToEnd = () => {
    const startIdx = activePageIndex;
    const rangeIds = pages.slice(startIdx).map((p) => p.id);
    setSelectedPageIds(rangeIds);
  };

  const selectAllPages = () => {
    setSelectedPageIds(pages.map((p) => p.id));
  };

  const clearPageSelection = () => {
    if (pages[activePageIndex]) {
      setSelectedPageIds([pages[activePageIndex].id]);
      rangeAnchorIndexRef.current = activePageIndex;
    } else {
      setSelectedPageIds([]);
    }
  };

  const rotatePageById = (pageId: string, deltaAngle: number) => {
    const updated = pages.map((p) => (p.id === pageId ? rotatePage(p, deltaAngle) : p));
    setPages(updated);
    pushHistory(updated, annotations, activePageIndex);
  };

  const rotateSelectedPages = (deltaAngle: number) => {
    if (selectedPageIds.length === 0) return;
    const targetSet = new Set(selectedPageIds);
    const updated = pages.map((p) => (targetSet.has(p.id) ? rotatePage(p, deltaAngle) : p));
    setPages(updated);
    pushHistory(updated, annotations, activePageIndex);
  };

  const deletePageById = (pageId: string) => {
    if (pages.length <= 1) return;
    const { updatedPages, nextActiveIndex } = deletePage(pages, pageId);
    const updatedAnnotations = annotations.filter((a) => a.pageId !== pageId);

    setPages(updatedPages);
    setActivePageIndex(nextActiveIndex);
    rangeAnchorIndexRef.current = nextActiveIndex;
    setSelectedPageIds(updatedPages[nextActiveIndex] ? [updatedPages[nextActiveIndex].id] : []);
    setAnnotations(updatedAnnotations);
    pushHistory(updatedPages, updatedAnnotations, nextActiveIndex);
  };

  const deleteSelectedPages = () => {
    if (pages.length <= 1 || selectedPageIds.length === 0) return;
    if (selectedPageIds.length >= pages.length) {
      // Don't delete entire document, keep at least the first
      const keepPage = pages[0];
      const updatedPages = [keepPage];
      const updatedAnnotations = annotations.filter((a) => a.pageId === keepPage.id);
      setPages(updatedPages);
      setActivePageIndex(0);
      rangeAnchorIndexRef.current = 0;
      setSelectedPageIds([keepPage.id]);
      setAnnotations(updatedAnnotations);
      pushHistory(updatedPages, updatedAnnotations, 0);
      return;
    }

    const deleteSet = new Set(selectedPageIds);
    const updatedPages = pages.filter((p) => !deleteSet.has(p.id));
    const updatedAnnotations = annotations.filter((a) => !deleteSet.has(a.pageId));
    const nextActive = Math.max(0, Math.min(activePageIndex, updatedPages.length - 1));

    setPages(updatedPages);
    setActivePageIndex(nextActive);
    rangeAnchorIndexRef.current = nextActive;
    setSelectedPageIds(updatedPages[nextActive] ? [updatedPages[nextActive].id] : []);
    setAnnotations(updatedAnnotations);
    pushHistory(updatedPages, updatedAnnotations, nextActive);
  };

  const reorderPagesByIndex = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    const updated = reorderPages(pages, fromIndex, toIndex);
    setPages(updated);
    setActivePageIndex(toIndex);
    rangeAnchorIndexRef.current = toIndex;
    pushHistory(updated, annotations, toIndex);
  };

  const insertPages = (
    newPages: PdfPageModel[],
    position: InsertPosition,
    newSource?: SourceDocument
  ) => {
    if (newSource) {
      setSources((prev) => [...prev, newSource]);
    }
    const { pages: updated, newActiveIndex } = insertPagesAtPosition(
      pages,
      newPages,
      position,
      activePageIndex
    );
    setPages(updated);
    setActivePageIndex(newActiveIndex);
    rangeAnchorIndexRef.current = newActiveIndex;
    setSelectedPageIds(newPages.map((p) => p.id));
    pushHistory(updated, annotations, newActiveIndex);
  };

  const addAnnotation = (ann: Annotation) => {
    const updated = [...annotations, ann];
    setAnnotations(updated);
    setSelectedAnnotationId(ann.id);
    pushHistory(pages, updated, activePageIndex);
  };

  const updateAnnotation = (ann: Annotation, recordHistory: boolean = false) => {
    const updated = annotations.map((a) => (a.id === ann.id ? ann : a));
    setAnnotations(updated);
    if (recordHistory) {
      pushHistory(pages, updated, activePageIndex);
    }
  };

  const deleteAnnotation = (id: string) => {
    const updated = annotations.filter((a) => a.id !== id);
    setAnnotations(updated);
    if (selectedAnnotationId === id) {
      setSelectedAnnotationId(null);
    }
    pushHistory(pages, updated, activePageIndex);
  };

  const undo = () => {
    if (historyIndex > 0) {
      const targetIndex = historyIndex - 1;
      const targetSnapshot = history[targetIndex];
      if (targetSnapshot) {
        setPages(deepClone(targetSnapshot.pages));
        setAnnotations(deepClone(targetSnapshot.annotations));
        setActivePageIndex(targetSnapshot.activePageIndex);
        rangeAnchorIndexRef.current = targetSnapshot.activePageIndex;
        setSelectedAnnotationId(null);
        setHistoryIndex(targetIndex);
      }
    }
  };

  const redo = () => {
    if (historyIndex < history.length - 1) {
      const targetIndex = historyIndex + 1;
      const targetSnapshot = history[targetIndex];
      if (targetSnapshot) {
        setPages(deepClone(targetSnapshot.pages));
        setAnnotations(deepClone(targetSnapshot.annotations));
        setActivePageIndex(targetSnapshot.activePageIndex);
        rangeAnchorIndexRef.current = targetSnapshot.activePageIndex;
        setSelectedAnnotationId(null);
        setHistoryIndex(targetIndex);
      }
    }
  };

  const saveAndDownload = async (customName?: string) => {
    if (pages.length === 0) return;
    setIsSaving(true);
    try {
      const baseName = customName || fileName.replace(/\.pdf$/i, '');
      const outName = baseName.endsWith('.pdf') ? baseName : `${baseName}-edited.pdf`;
      await exportEditedPdf(sources, pages, annotations, outName);
    } catch (e) {
      console.error('Failed to export PDF:', e);
    } finally {
      setIsSaving(false);
    }
  };

  // Keyboard shortcut listener for Ctrl+Z / Ctrl+Y / Delete / PageUp / PageDown / Arrows / Ctrl+A
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement)?.tagName === 'INPUT' ||
        (e.target as HTMLElement)?.tagName === 'TEXTAREA'
      ) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (
        ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z')
      ) {
        e.preventDefault();
        redo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        selectAllPages();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === '0' || e.key === 'NumPad0')) {
        e.preventDefault();
        zoomToFitPage();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        setScale((s) => Math.min(3.0, Number((s + 0.15).toFixed(2))));
      } else if ((e.ctrlKey || e.metaKey) && (e.key === '-' || e.key === '_')) {
        e.preventDefault();
        setScale((s) => Math.max(0.4, Number((s - 0.15).toFixed(2))));
      } else if (e.shiftKey && e.key === 'PageDown') {
        e.preventDefault();
        selectRangeToEnd();
      } else if (e.shiftKey && e.key === 'PageUp') {
        e.preventDefault();
        selectRangeToStart();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault();
        navigatePage(1, e.shiftKey);
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault();
        navigatePage(-1, e.shiftKey);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedAnnotationId) {
          e.preventDefault();
          deleteAnnotation(selectedAnnotationId);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [historyIndex, history, selectedAnnotationId, activePageIndex, pages, selectedPageIds]);

  const value = {
    fileName,
    setFileName,
    sources,
    pages,
    activePageIndex,
    selectedPageIds,
    annotations,
    selectedAnnotationId,
    scale,
    isSaving,
    canUndo: historyIndex > 0,
    canRedo: historyIndex < history.length - 1,
    historyLength: history.length,
    historyIndex,
    loadPdfFile,
    loadSamplePdf,
    setActivePageIndex,
    setScale,
    zoomToFitPage,
    zoomToFitWidth,
    setSelectedPageIds,
    togglePageSelection,
    navigatePage,
    selectRangeToStart,
    selectRangeToEnd,
    selectAllPages,
    clearPageSelection,
    rotatePageById,
    rotateSelectedPages,
    deletePageById,
    deleteSelectedPages,
    reorderPagesByIndex,
    insertPages,
    addAnnotation,
    updateAnnotation,
    deleteAnnotation,
    setSelectedAnnotationId,
    undo,
    redo,
    commitHistorySnapshot,
    saveAndDownload,
  };

  return <DocumentContext.Provider value={value}>{children}</DocumentContext.Provider>;
};

export const useDocument = (): DocumentContextType => {
  const context = useContext(DocumentContext);
  if (!context) {
    throw new Error('useDocument must be used within a DocumentProvider');
  }
  return context;
};
