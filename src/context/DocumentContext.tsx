import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { PdfPageModel, SourceDocument, RasterizationSettings, DocumentMetadata, DEFAULT_DOCUMENT_METADATA } from '../types/document';
import { Annotation } from '../types/annotations';
import { exportEditedPdf } from '../services/pdfExporter';
import { deletePage, reorderPages, rotatePage, insertPagesAtPosition, InsertPosition } from '../services/pageManager';
import { parsePdfPages, extractPdfAnnotations, extractPdfMetadata, clearPdfCache } from '../services/pdfLoader';
import { logger } from '../services/logger';

import {
  replaceTextInPageContentStream,
  replaceTextInAllPagesContentStream,
  getPageContentStream,
  updatePageContentStream,
  updateStreamSegmentInPage,
  getPageImages,
  removeMultipleElementsFromPage,
  PageImageInfo,
  StreamSegment,
} from '../services/contentStreamEditor';

import { FormFieldModel, FormExportMode } from '../types/form';
import { extractFormFieldsFromPdf } from '../services/formService';
import { signPdfWithCertificate, DigitalSignatureOptions } from '../services/digitalSignatureService';

interface HistorySnapshot {
  pages: PdfPageModel[];
  annotations: Annotation[];
  activePageIndex: number;
  sources?: SourceDocument[];
  formValues?: Record<string, string | boolean | string[]>;
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

  // Metadata
  metadata: DocumentMetadata;
  setMetadata: React.Dispatch<React.SetStateAction<DocumentMetadata>>;
  updateMetadata: (fields: Partial<DocumentMetadata>) => void;
  
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

  // Direct Content Stream Editing
  getPageStream: (pageIndex?: number) => Promise<{ streamText: string; streamCount: number; error?: string }>;
  applyPageContentStreamEdit: (newStreamContent: string, pageIndex?: number) => Promise<{ success: boolean; updatedStream?: string; error?: string }>;
  applyStreamSegmentEdit: (originalSegment: string, newSegment: string, pageIndex?: number) => Promise<{ success: boolean; updatedStream?: string; error?: string }>;
  applyContentStreamReplacement: (
    searchText: string,
    replaceText: string,
    options?: {
      pageIndex?: number;
      replaceAllPages?: boolean;
      matchCase?: boolean;
    }
  ) => Promise<{ success: boolean; totalReplaced: number; error?: string }>;
  getPageImagesList: (pageIndex?: number) => Promise<{ images: PageImageInfo[]; error?: string }>;
  removePageImage: (imageName: string, pageIndex?: number) => Promise<{ success: boolean; error?: string }>;
  removePageBlock: (segment: StreamSegment, pageIndex?: number) => Promise<{ success: boolean; updatedStream?: string; error?: string }>;
  removeMultiplePageElements: (
    segmentIds: string[],
    imageNames: string[],
    pageIndex?: number
  ) => Promise<{ success: boolean; removedCount: number; updatedStream?: string; error?: string }>;
  
  // Interactive Form Fields (AcroForms)
  formFields: FormFieldModel[];
  formValues: Record<string, string | boolean | string[]>;
  updateFormFieldValue: (name: string, value: string | boolean | string[], commitHistory?: boolean) => void;
  hasFormFields: boolean;

  // Undo / Redo / Export
  undo: () => void;
  redo: () => void;
  commitHistorySnapshot: () => void;
  saveAndDownload: (
    customName?: string,
    rasterSettings?: RasterizationSettings,
    metadataOverride?: DocumentMetadata,
    formExportMode?: FormExportMode
  ) => Promise<boolean>;
  signAndDownload: (
    privateKeyPem: string,
    certificatePem: string,
    options?: DigitalSignatureOptions,
    customName?: string,
    rasterSettings?: RasterizationSettings
  ) => Promise<boolean>;
}

const DocumentContext = createContext<DocumentContextType | null>(null);

// Deep clone helper for immutable history snapshots (JSON-serializable objects)
const deepClone = <T,>(obj: T): T => {
  return JSON.parse(JSON.stringify(obj));
};

// Specialized clone helper for SourceDocument preserving binary ArrayBuffer data
export const cloneSourceDocument = (source: SourceDocument, timestamp?: number): SourceDocument => {
  const clonedBuffer: ArrayBuffer = source.arrayBuffer
    ? source.arrayBuffer.slice(0)
    : new ArrayBuffer(0);
  return {
    ...source,
    arrayBuffer: clonedBuffer,
    updatedAt: timestamp !== undefined ? timestamp : (source.updatedAt || Date.now()),
  };
};

export const cloneSources = (sourcesList: SourceDocument[], timestamp?: number): SourceDocument[] => {
  return sourcesList.map((s) => cloneSourceDocument(s, timestamp));
};

export const DocumentProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [fileName, setFileName] = useState<string>('document.pdf');
  const [sources, setSources] = useState<SourceDocument[]>([]);
  const [pages, setPages] = useState<PdfPageModel[]>([]);
  const [activePageIndex, setActivePageIndex] = useState<number>(0);
  const [selectedPageIds, setSelectedPageIds] = useState<string[]>([]);
  const rangeAnchorIndexRef = useRef<number>(0);
  
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [scale, setScale] = useState<number>(1.2);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [metadata, setMetadata] = useState<DocumentMetadata>(DEFAULT_DOCUMENT_METADATA);

  // Interactive Form Fields State
  const [formFields, setFormFields] = useState<FormFieldModel[]>([]);
  const [formValues, setFormValues] = useState<Record<string, string | boolean | string[]>>({});

  const updateMetadata = useCallback((fields: Partial<DocumentMetadata>) => {
    setMetadata((prev) => ({ ...prev, ...fields }));
  }, []);

  // Undo / Redo history stack
  const [history, setHistory] = useState<HistorySnapshot[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);

  const pushHistory = useCallback(
    (
      newPages: PdfPageModel[],
      newAnnotations: Annotation[],
      newActiveIndex: number,
      newSources?: SourceDocument[],
      newFormValues?: Record<string, string | boolean | string[]>
    ) => {
      setHistory((prev) => {
        const next = prev.slice(0, historyIndex + 1);
        const snapshot: HistorySnapshot = {
          pages: deepClone(newPages),
          annotations: deepClone(newAnnotations),
          activePageIndex: newActiveIndex,
          sources: cloneSources(newSources || sources),
          formValues: deepClone(newFormValues !== undefined ? newFormValues : formValues),
        };

        if (next.length >= MAX_HISTORY) {
          next.shift();
        }
        return [...next, snapshot];
      });
      setHistoryIndex((prev) => Math.min(prev + 1, MAX_HISTORY - 1));
    },
    [historyIndex, sources, formValues]
  );

  const updateFormFieldValue = useCallback(
    (name: string, value: string | boolean | string[], commitHistory: boolean = false) => {
      setFormValues((prev) => {
        const next = { ...prev, [name]: value };
        if (commitHistory) {
          pushHistory(pages, annotations, activePageIndex, undefined, next);
        }
        return next;
      });
    },
    [pages, annotations, activePageIndex, pushHistory]
  );

  const commitHistorySnapshot = useCallback(() => {
    pushHistory(pages, annotations, activePageIndex);
  }, [pages, annotations, activePageIndex, pushHistory]);

  const loadPdfFile = async (file: File) => {
    logger.info('load', `Otevřen soubor: "${file.name}" (${(file.size / 1024).toFixed(1)} KB, type: ${file.type || 'unknown'})`, {
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type,
      lastModified: file.lastModified,
    });
    try {
      const buffer = await file.arrayBuffer();
      clearPdfCache();
      const mainSource: SourceDocument = {
        id: 'main',
        name: file.name,
        arrayBuffer: buffer,
        updatedAt: Date.now(),
      };

      const parsedPages = await parsePdfPages(buffer, 'main');
      const loadedAnnotations = await extractPdfAnnotations(buffer, 'main', parsedPages);
      const extractedMeta = await extractPdfMetadata('main', buffer);
      const extractedFormFields = await extractFormFieldsFromPdf(buffer, 'main', parsedPages);

      const initialFormValues: Record<string, string | boolean | string[]> = {};
      extractedFormFields.forEach((field) => {
        initialFormValues[field.name] = field.value;
      });

      setFileName(file.name);
      setSources([mainSource]);
      setPages(parsedPages);
      setActivePageIndex(0);
      rangeAnchorIndexRef.current = 0;
      setSelectedPageIds(parsedPages.length > 0 ? [parsedPages[0].id] : []);
      setAnnotations(loadedAnnotations);
      setSelectedAnnotationId(null);
      setMetadata(extractedMeta);
      setFormFields(extractedFormFields);
      setFormValues(initialFormValues);

      // Initialize history with initial source documents (proper binary clone)
      setHistory([{
        pages: deepClone(parsedPages),
        annotations: deepClone(loadedAnnotations),
        activePageIndex: 0,
        sources: cloneSources([mainSource]),
        formValues: deepClone(initialFormValues),
      }]);
      setHistoryIndex(0);
      logger.success('load', `Dokument "${file.name}" připraven k úpravám (${parsedPages.length} stran)`);
    } catch (e: any) {
      logger.error('load', `Chyba při otevírání souboru "${file.name}": ${e?.message || e}`, e);
      console.error('Failed to load PDF file:', e);
      throw e;
    }
  };

  const loadSamplePdf = async (buffer: ArrayBuffer, _lang: string) => {
    logger.info('load', 'Otevírání ukázkového PDF dokumentu');
    try {
      clearPdfCache();
      const mainSource: SourceDocument = {
        id: 'main',
        name: 'sample-contract.pdf',
        arrayBuffer: buffer,
        updatedAt: Date.now(),
      };

      const parsedPages = await parsePdfPages(buffer, 'main');
      const loadedAnnotations = await extractPdfAnnotations(buffer, 'main', parsedPages);
      const extractedFormFields = await extractFormFieldsFromPdf(buffer, 'main', parsedPages);

      const initialFormValues: Record<string, string | boolean | string[]> = {};
      extractedFormFields.forEach((field) => {
        initialFormValues[field.name] = field.value;
      });

      const sampleMeta: DocumentMetadata = {
        title: _lang === 'cs' ? 'Ukázková smlouva o dílo' : 'Sample Agreement',
        author: 'Richard Lipka',
        subject: _lang === 'cs' ? 'Ukázkový dokument pro PDF Studio' : 'Sample document for PDF Studio',
        keywords: 'PDF Studio, sample, contract',
        creator: 'PDF Studio',
        producer: 'PDF Studio (https://richardlipka.github.io/pdf-studio/)',
        creationDate: new Date().toISOString(),
      };

      setFileName('sample-contract.pdf');
      setSources([mainSource]);
      setPages(parsedPages);
      setActivePageIndex(0);
      rangeAnchorIndexRef.current = 0;
      setSelectedPageIds(parsedPages.length > 0 ? [parsedPages[0].id] : []);
      setAnnotations(loadedAnnotations);
      setSelectedAnnotationId(null);
      setMetadata(sampleMeta);
      setFormFields(extractedFormFields);
      setFormValues(initialFormValues);

      setHistory([{
        pages: deepClone(parsedPages),
        annotations: deepClone(loadedAnnotations),
        activePageIndex: 0,
        sources: cloneSources([mainSource]),
        formValues: deepClone(initialFormValues),
      }]);
      setHistoryIndex(0);
      logger.success('load', `Ukázkový dokument úspěšně načten (${parsedPages.length} stran)`);
    } catch (e: any) {
      logger.error('load', `Chyba při načítání ukázkového dokumentu: ${e?.message || e}`, e);
      throw e;
    }
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

  // Multi-Page Selection Logic (Anchor-based Range Selection)
  const togglePageSelection = (pageId: string, isMulti: boolean, isRange: boolean) => {
    const clickedIdx = pages.findIndex((p) => p.id === pageId);
    if (clickedIdx === -1) return;

    setActivePageIndex(clickedIdx);

    if (isRange) {
      // Shift + Click: Select block from anchor to clickedIdx
      const anchorIdx =
        rangeAnchorIndexRef.current >= 0 && rangeAnchorIndexRef.current < pages.length
          ? rangeAnchorIndexRef.current
          : 0;

      const start = Math.min(clickedIdx, anchorIdx);
      const end = Math.max(clickedIdx, anchorIdx);
      const rangeIds = pages.slice(start, end + 1).map((p) => p.id);

      if (isMulti) {
        // Ctrl + Shift + Click: Union of existing selection and new range
        const union = Array.from(new Set([...selectedPageIds, ...rangeIds]));
        setSelectedPageIds(union);
      } else {
        // Pure Shift + Click: Exact block from anchor to clickedIdx
        setSelectedPageIds(rangeIds);
      }
      // Keep anchorIdx fixed so subsequent Shift+clicks adjust the range from the original anchor
      return;
    }

    if (isMulti) {
      // Ctrl + Click: Toggle individual page
      if (selectedPageIds.includes(pageId)) {
        if (selectedPageIds.length > 1) {
          setSelectedPageIds(selectedPageIds.filter((id) => id !== pageId));
        }
      } else {
        setSelectedPageIds([...selectedPageIds, pageId]);
      }
      rangeAnchorIndexRef.current = clickedIdx;
    } else {
      // Normal Click: Single selection and reset anchor
      setSelectedPageIds([pageId]);
      rangeAnchorIndexRef.current = clickedIdx;
    }
  };

  // Keyboard Arrow Navigation (with Shift + Arrow Block Selection)
  const navigatePage = (delta: number, isShift: boolean) => {
    if (pages.length === 0) return;
    const nextIndex = Math.max(0, Math.min(pages.length - 1, activePageIndex + delta));
    if (nextIndex === activePageIndex && !isShift) return;

    setActivePageIndex(nextIndex);

    if (isShift) {
      // Shift + Arrow: Select block from anchor to nextIndex
      const anchor =
        rangeAnchorIndexRef.current >= 0 && rangeAnchorIndexRef.current < pages.length
          ? rangeAnchorIndexRef.current
          : activePageIndex;

      const start = Math.min(anchor, nextIndex);
      const end = Math.max(anchor, nextIndex);
      const rangeIds = pages.slice(start, end + 1).map((p) => p.id);
      setSelectedPageIds(rangeIds);
      // Anchor stays fixed so repeated Shift+Arrows expand/shrink block seamlessly
    } else {
      // Plain Arrow: Move active page and reset anchor
      rangeAnchorIndexRef.current = nextIndex;
      setSelectedPageIds([pages[nextIndex].id]);
    }
  };

  const selectRangeToStart = () => {
    if (pages.length === 0) return;
    const anchor =
      rangeAnchorIndexRef.current >= 0 && rangeAnchorIndexRef.current < pages.length
        ? rangeAnchorIndexRef.current
        : activePageIndex;
    const rangeIds = pages.slice(0, anchor + 1).map((p) => p.id);
    setSelectedPageIds(rangeIds);
    setActivePageIndex(0);
  };

  const selectRangeToEnd = () => {
    if (pages.length === 0) return;
    const anchor =
      rangeAnchorIndexRef.current >= 0 && rangeAnchorIndexRef.current < pages.length
        ? rangeAnchorIndexRef.current
        : activePageIndex;
    const rangeIds = pages.slice(anchor).map((p) => p.id);
    setSelectedPageIds(rangeIds);
    setActivePageIndex(pages.length - 1);
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
        if (targetSnapshot.formValues) {
          setFormValues(deepClone(targetSnapshot.formValues));
        }
        if (targetSnapshot.sources && targetSnapshot.sources.length > 0) {
          clearPdfCache();
          const restoredSources = cloneSources(targetSnapshot.sources, Date.now());
          setSources(restoredSources);
        }
        setHistoryIndex(targetIndex);
        logger.info('system', `Krok Zpět (Undo): obnoven stav #${targetIndex + 1}`);
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
        if (targetSnapshot.formValues) {
          setFormValues(deepClone(targetSnapshot.formValues));
        }
        if (targetSnapshot.sources && targetSnapshot.sources.length > 0) {
          clearPdfCache();
          const restoredSources = cloneSources(targetSnapshot.sources, Date.now());
          setSources(restoredSources);
        }
        setHistoryIndex(targetIndex);
        logger.info('system', `Krok Vpřed (Redo): obnoven stav #${targetIndex + 1}`);
      }
    }
  };

  const applyContentStreamReplacement = async (
    searchText: string,
    replaceText: string,
    options: {
      pageIndex?: number;
      replaceAllPages?: boolean;
      matchCase?: boolean;
    } = {}
  ): Promise<{ success: boolean; totalReplaced: number; error?: string }> => {
    if (!searchText) {
      return { success: false, totalReplaced: 0, error: 'Chybí hledaný text' };
    }

    const {
      pageIndex = activePageIndex,
      replaceAllPages = false,
      matchCase = true,
    } = options;

    const targetPage = pages[pageIndex];
    if (!targetPage) {
      return { success: false, totalReplaced: 0, error: 'Stránka nenalezena' };
    }

    const sourceDoc = sources.find((s) => s.id === targetPage.sourceDocId);
    if (!sourceDoc || !sourceDoc.arrayBuffer) {
      return {
        success: false,
        totalReplaced: 0,
        error: 'Zdrojový PDF dokument nenalezen nebo je rastrovým obrázkem',
      };
    }

    let result;
    if (replaceAllPages) {
      result = await replaceTextInAllPagesContentStream(
        sourceDoc.arrayBuffer,
        searchText,
        replaceText,
        { matchCase }
      );
    } else {
      const sourcePageIndex =
        targetPage.originalPageIndex !== undefined
          ? targetPage.originalPageIndex
          : pageIndex;
      result = await replaceTextInPageContentStream(
        sourceDoc.arrayBuffer,
        sourcePageIndex,
        searchText,
        replaceText,
        { matchCase }
      );
    }

    if (result.occurrencesReplaced > 0) {
      const updatedSources = sources.map((s) => {
        if (s.id === sourceDoc.id) {
          return {
            ...s,
            arrayBuffer: result.updatedPdfBytes,
            updatedAt: Date.now(),
          };
        }
        return s;
      });

      clearPdfCache();
      setSources(updatedSources);
      pushHistory(pages, annotations, activePageIndex, updatedSources);
      return { success: true, totalReplaced: result.occurrencesReplaced };
    }

    if (result.error) {
      return { success: false, totalReplaced: 0, error: result.error };
    }

    return { success: false, totalReplaced: 0 };
  };

  const getPageStream = async (
    pageIndex: number = activePageIndex
  ): Promise<{ streamText: string; streamCount: number; error?: string }> => {
    const targetPage = pages[pageIndex];
    if (!targetPage) {
      return { streamText: '', streamCount: 0, error: 'Stránka nenalezena' };
    }
    const sourceDoc = sources.find((s) => s.id === targetPage.sourceDocId);
    if (!sourceDoc || !sourceDoc.arrayBuffer) {
      return { streamText: '', streamCount: 0, error: 'Zdrojový PDF dokument nenalezen' };
    }
    const sourcePageIndex =
      targetPage.originalPageIndex !== undefined
        ? targetPage.originalPageIndex
        : pageIndex;
    return getPageContentStream(sourceDoc.arrayBuffer, sourcePageIndex);
  };

  const applyPageContentStreamEdit = async (
    newStreamContent: string,
    pageIndex: number = activePageIndex
  ): Promise<{ success: boolean; updatedStream?: string; error?: string }> => {
    const targetPage = pages[pageIndex];
    if (!targetPage) {
      return { success: false, error: 'Stránka nenalezena' };
    }
    const sourceDoc = sources.find((s) => s.id === targetPage.sourceDocId);
    if (!sourceDoc || !sourceDoc.arrayBuffer) {
      return { success: false, error: 'Zdrojový PDF dokument nenalezen' };
    }
    const sourcePageIndex =
      targetPage.originalPageIndex !== undefined
        ? targetPage.originalPageIndex
        : pageIndex;
    const result = await updatePageContentStream(
      sourceDoc.arrayBuffer,
      sourcePageIndex,
      newStreamContent
    );
    if (result.error) {
      return { success: false, error: result.error };
    }

    const updatedSources = sources.map((s) => {
      if (s.id === sourceDoc.id) {
        return {
          ...s,
          arrayBuffer: result.updatedPdfBytes,
          updatedAt: Date.now(),
        };
      }
      return s;
    });

    clearPdfCache();
    setSources(updatedSources);
    pushHistory(pages, annotations, activePageIndex, updatedSources);
    return { success: true, updatedStream: result.updatedStream };
  };

  const applyStreamSegmentEdit = async (
    originalSegment: string,
    newSegment: string,
    pageIndex: number = activePageIndex
  ): Promise<{ success: boolean; updatedStream?: string; error?: string }> => {
    const targetPage = pages[pageIndex];
    if (!targetPage) {
      return { success: false, error: 'Stránka nenalezena' };
    }
    const sourceDoc = sources.find((s) => s.id === targetPage.sourceDocId);
    if (!sourceDoc || !sourceDoc.arrayBuffer) {
      return { success: false, error: 'Zdrojový PDF dokument nenalezen' };
    }
    const sourcePageIndex =
      targetPage.originalPageIndex !== undefined
        ? targetPage.originalPageIndex
        : pageIndex;
    const result = await updateStreamSegmentInPage(
      sourceDoc.arrayBuffer,
      sourcePageIndex,
      originalSegment,
      newSegment
    );
    if (result.error) {
      return { success: false, error: result.error };
    }

    const updatedSources = sources.map((s) => {
      if (s.id === sourceDoc.id) {
        return {
          ...s,
          arrayBuffer: result.updatedPdfBytes,
          updatedAt: Date.now(),
        };
      }
      return s;
    });

    clearPdfCache();
    setSources(updatedSources);
    pushHistory(pages, annotations, activePageIndex, updatedSources);
    return { success: true, updatedStream: result.updatedStream };
  };

  const getPageImagesList = async (
    pageIndex: number = activePageIndex
  ): Promise<{ images: PageImageInfo[]; error?: string }> => {
    const targetPage = pages[pageIndex];
    if (!targetPage) {
      return { images: [], error: 'Stránka nenalezena' };
    }
    const sourceDoc = sources.find((s) => s.id === targetPage.sourceDocId);
    if (!sourceDoc || !sourceDoc.arrayBuffer) {
      return { images: [], error: 'Zdrojový PDF dokument nenalezen' };
    }
    const sourcePageIndex =
      targetPage.originalPageIndex !== undefined
        ? targetPage.originalPageIndex
        : pageIndex;
    return getPageImages(sourceDoc.arrayBuffer, sourcePageIndex);
  };

  const removePageImage = async (
    imageName: string,
    pageIndex: number = activePageIndex
  ): Promise<{ success: boolean; error?: string }> => {
    const res = await removeMultiplePageElements([], [imageName], pageIndex);
    return { success: res.success, error: res.error };
  };

  const removePageBlock = async (
    segment: StreamSegment,
    pageIndex: number = activePageIndex
  ): Promise<{ success: boolean; updatedStream?: string; error?: string }> => {
    const res = await removeMultiplePageElements([segment.id], [], pageIndex);
    return { success: res.success, updatedStream: res.updatedStream, error: res.error };
  };

  const removeMultiplePageElements = async (
    segmentIds: string[],
    imageNames: string[],
    pageIndex: number = activePageIndex
  ): Promise<{ success: boolean; removedCount: number; updatedStream?: string; error?: string }> => {
    const targetPage = pages[pageIndex];
    if (!targetPage) {
      return { success: false, removedCount: 0, error: 'Stránka nenalezena' };
    }
    const sourceDoc = sources.find((s) => s.id === targetPage.sourceDocId);
    if (!sourceDoc || !sourceDoc.arrayBuffer) {
      return { success: false, removedCount: 0, error: 'Zdrojový PDF dokument nenalezen' };
    }
    const sourcePageIndex =
      targetPage.originalPageIndex !== undefined
        ? targetPage.originalPageIndex
        : pageIndex;

    const result = await removeMultipleElementsFromPage(
      sourceDoc.arrayBuffer,
      sourcePageIndex,
      segmentIds,
      imageNames
    );

    if (result.error) {
      return { success: false, removedCount: 0, error: result.error };
    }

    const updatedSources = sources.map((s) => {
      if (s.id === sourceDoc.id) {
        return {
          ...s,
          arrayBuffer: result.updatedPdfBytes,
          updatedAt: Date.now(),
        };
      }
      return s;
    });

    clearPdfCache();
    setSources(updatedSources);
    pushHistory(pages, annotations, activePageIndex, updatedSources);
    return { success: true, removedCount: result.removedCount, updatedStream: result.updatedStream };
  };

  const saveAndDownload = async (
    customName?: string,
    rasterSettings?: RasterizationSettings,
    metadataOverride?: DocumentMetadata,
    formExportMode: FormExportMode = 'interactive'
  ): Promise<boolean> => {
    if (pages.length === 0) return false;
    setIsSaving(true);
    try {
      const baseName = customName || fileName.replace(/\.pdf$/i, '');
      const outName = baseName.endsWith('.pdf') ? baseName : `${baseName}-edited.pdf`;
      const metaToApply = metadataOverride || metadata;
      const bytes = await exportEditedPdf(
        sources,
        pages,
        annotations,
        outName,
        rasterSettings,
        metaToApply,
        formValues,
        formExportMode
      );
      return Boolean(bytes && bytes.length > 0);
    } catch (e: any) {
      logger.error('save', `Chyba při exportu dokumentu: ${e?.message || e}`, e);
      console.error('Failed to export PDF:', e);
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const signAndDownload = async (
    privateKeyPem: string,
    certificatePem: string,
    options: DigitalSignatureOptions = {},
    customName?: string,
    rasterSettings?: RasterizationSettings
  ): Promise<boolean> => {
    if (pages.length === 0) return false;
    setIsSaving(true);
    try {
      const baseName = customName || fileName.replace(/\.pdf$/i, '');
      const outName = baseName.endsWith('.pdf') ? baseName.replace(/\.pdf$/i, '-signed.pdf') : `${baseName}-signed.pdf`;

      // 1. Generate base edited PDF
      const baseBytes = await exportEditedPdf(
        sources,
        pages,
        annotations,
        outName,
        rasterSettings,
        metadata,
        formValues,
        'interactive'
      );

      if (!baseBytes || baseBytes.length === 0) {
        throw new Error('Nepodařilo se vygenerovat podkladový PDF soubor k podepsání.');
      }

      // 2. Cryptographically sign via PAdES PKCS#7
      const pdfArrayBuffer = baseBytes.buffer.slice(
        baseBytes.byteOffset,
        baseBytes.byteOffset + baseBytes.byteLength
      ) as ArrayBuffer;

      const signResult = await signPdfWithCertificate(
        pdfArrayBuffer,
        privateKeyPem,
        certificatePem,
        {
          ...options,
          pageIndex: options.pageIndex !== undefined ? options.pageIndex : activePageIndex,
        }
      );

      // 3. Download signed PDF
      const blob = new Blob([signResult.signedPdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = outName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      return true;
    } catch (e: any) {
      logger.error('crypto', `Chyba při digitálním podepisování a stahování PDF: ${e?.message || e}`, e);
      console.error('Failed to digitally sign PDF:', e);
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  // Keyboard shortcut listener for Ctrl+Z / Ctrl+Y / Delete / PageUp / PageDown / Arrows / Ctrl+A
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const targetEl = e.target as HTMLElement | null;
      if (
        targetEl?.tagName === 'INPUT' ||
        targetEl?.tagName === 'TEXTAREA' ||
        targetEl?.tagName === 'SELECT' ||
        targetEl?.isContentEditable ||
        targetEl?.closest('[contenteditable="true"]')
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
      } else if (e.shiftKey && (e.key === 'PageDown' || e.key === 'End')) {
        e.preventDefault();
        selectRangeToEnd();
      } else if (e.shiftKey && (e.key === 'PageUp' || e.key === 'Home')) {
        e.preventDefault();
        selectRangeToStart();
      } else if (!e.shiftKey && e.key === 'Home') {
        e.preventDefault();
        if (pages.length > 0) {
          rangeAnchorIndexRef.current = 0;
          setActivePageIndex(0);
          setSelectedPageIds([pages[0].id]);
        }
      } else if (!e.shiftKey && e.key === 'End') {
        e.preventDefault();
        if (pages.length > 0) {
          const lastIdx = pages.length - 1;
          rangeAnchorIndexRef.current = lastIdx;
          setActivePageIndex(lastIdx);
          setSelectedPageIds([pages[lastIdx].id]);
        }
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || (!e.shiftKey && e.key === 'PageDown')) {
        e.preventDefault();
        navigatePage(1, e.shiftKey);
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft' || (!e.shiftKey && e.key === 'PageUp')) {
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
    metadata,
    setMetadata,
    updateMetadata,
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
    getPageStream,
    applyPageContentStreamEdit,
    applyStreamSegmentEdit,
    applyContentStreamReplacement,
    getPageImagesList,
    removePageImage,
    removePageBlock,
    removeMultiplePageElements,
    formFields,
    formValues,
    updateFormFieldValue,
    hasFormFields: formFields.length > 0,
    undo,
    redo,
    commitHistorySnapshot,
    saveAndDownload,
    signAndDownload,
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
