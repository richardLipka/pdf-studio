import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { PdfPageModel, SourceDocument, RasterizationSettings, DocumentMetadata, DEFAULT_DOCUMENT_METADATA } from '../types/document';
import { Annotation } from '../types/annotations';
import { exportEditedPdf } from '../services/pdfExporter';
import { flattenPdfToImages, FlattenOptions } from '../services/pdfFlattener';
import {
  deletePage,
  reorderPages,
  rotatePage,
  rotateAnnotationWithPage,
  insertPagesAtPosition,
  InsertPosition,
} from '../services/pageManager';
import {
  parsePdfPages,
  extractPdfAnnotations,
  extractPdfMetadata,
  clearPdfCache,
  getPageTextModel,
} from '../services/pdfLoader';
import { replaceTextBlockContent, replaceTextLineContent } from '../services/pdfTextEditor';
import { logger } from '../services/logger';
import { downloadBlob } from '../utils/file';

import {
  replaceTextInPageContentStream,
  replaceTextInAllPagesContentStream,
  getPageContentStream,
  updatePageContentStream,
  updateStreamSegmentInPage,
  getPageImages,
  replaceImageOnPage,
  extractImageBytesFromPdf,
  removeMultipleElementsFromPage,
  PageImageInfo,
  StreamSegment,
} from '../services/contentStreamEditor';

import { FormFieldModel, FormExportMode } from '../types/form';
import { extractFormFieldsFromPdf } from '../services/formService';
import { signPdfWithCertificate, DigitalSignatureOptions } from '../services/digitalSignatureService';

// History snapshots share object references with the live state. Pages, annotations, form values and
// source buffers are never mutated in place (every edit produces new objects / new ArrayBuffers), so
// structural sharing is safe and keeps binary data (image page bytes, PDF buffers) intact and cheap.
interface HistorySnapshot {
  pages: PdfPageModel[];
  annotations: Annotation[];
  activePageIndex: number;
  sources: SourceDocument[];
  formValues: Record<string, string | boolean | string[]>;
}

interface HistoryState {
  entries: HistorySnapshot[];
  index: number;
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
  /** scrollIntoView: false when the page is activated by clicking on it (it is already in view) */
  setActivePageIndex: (index: number, options?: { scrollIntoView?: boolean }) => void;
  /** True once after setActivePageIndex(..., { scrollIntoView: false }) */
  consumeActivePageScrollSkip: () => boolean;
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
  insertPages: (
    newPages: PdfPageModel[],
    position: InsertPosition,
    newSource?: SourceDocument,
    newAnnotations?: Annotation[]
  ) => void;

  // Annotation Operations
  addAnnotation: (annotation: Annotation) => void;
  updateAnnotation: (annotation: Annotation, recordHistory?: boolean) => void;
  deleteAnnotation: (id: string) => void;
  setSelectedAnnotationId: (id: string | null) => void;

  // Direct Content Stream Editing
  getPageStream: (pageIndex?: number) => Promise<{ streamText: string; streamCount: number; isEncrypted?: boolean; error?: string }>;
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
  replacePageImage: (
    imageName: string,
    fileOrBytes: File | Blob | ArrayBuffer | Uint8Array,
    mimeType?: 'image/png' | 'image/jpeg' | 'image/webp',
    pageIndex?: number
  ) => Promise<{ success: boolean; error?: string }>;
  exportPageImage: (
    imageName: string,
    pageIndex?: number,
    canvasEl?: HTMLCanvasElement | null,
    pdfBox?: { x: number; y: number; width: number; height: number }
  ) => Promise<{ success: boolean; error?: string }>;
  removePageImage: (imageName: string, pageIndex?: number) => Promise<{ success: boolean; error?: string }>;
  removePageBlock: (segment: StreamSegment, pageIndex?: number) => Promise<{ success: boolean; updatedStream?: string; error?: string }>;
  removeMultiplePageElements: (
    segmentIds: string[],
    imageNames: string[],
    pageIndex?: number,
    expectedContents?: Record<string, string>
  ) => Promise<{ success: boolean; removedCount: number; updatedStream?: string; error?: string }>;
  /** Replaces the text of one text object, keeping its position, size and colour */
  applyBlockTextEdit: (
    segmentId: string,
    newText: string,
    pageIndex?: number
  ) => Promise<{ success: boolean; updatedStream?: string; fontSubstituted?: boolean; error?: string }>;
  /** Replaces the text of one line of a text object (id from the page text model: `segmentId#n`) */
  applyLineTextEdit: (
    lineId: string,
    newText: string,
    pageIndex?: number
  ) => Promise<{ success: boolean; fontSubstituted?: boolean; error?: string }>;

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
  /** Exports the document with everything burned in, renders each page to an image and downloads the image-only PDF */
  flattenAndDownload: (
    options: FlattenOptions,
    onProgress?: (done: number, total: number) => void
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

const sameSourceBuffers = (a: SourceDocument[], b: SourceDocument[]): boolean =>
  a === b || (a.length === b.length && a.every((s, i) => s.id === b[i].id && s.arrayBuffer === b[i].arrayBuffer));

const sameAnnotationContent = (a: Annotation, b: Annotation): boolean =>
  a === b || JSON.stringify({ ...a, updatedAt: 0 }) === JSON.stringify({ ...b, updatedAt: 0 });

// Skips history entries that would not change anything (e.g. an editor committing on blur and again on "Done")
const isSameSnapshot = (a: HistorySnapshot, b: HistorySnapshot): boolean =>
  a.pages === b.pages &&
  a.formValues === b.formValues &&
  sameSourceBuffers(a.sources, b.sources) &&
  a.annotations.length === b.annotations.length &&
  a.annotations.every((ann, i) => sameAnnotationContent(ann, b.annotations[i]));

export const DocumentProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [fileName, setFileName] = useState<string>('document.pdf');
  const [sources, setSourcesState] = useState<SourceDocument[]>([]);
  const [pages, setPagesState] = useState<PdfPageModel[]>([]);
  const [activePageIndex, setActivePageIndexState] = useState<number>(0);
  const [selectedPageIds, setSelectedPageIds] = useState<string[]>([]);
  const rangeAnchorIndexRef = useRef<number>(0);

  const [annotations, setAnnotationsState] = useState<Annotation[]>([]);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [scale, setScale] = useState<number>(1.2);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [metadata, setMetadata] = useState<DocumentMetadata>(DEFAULT_DOCUMENT_METADATA);

  // Interactive Form Fields State
  const [formFields, setFormFields] = useState<FormFieldModel[]>([]);
  const [formValues, setFormValuesState] = useState<Record<string, string | boolean | string[]>>({});

  // Undo / Redo history stack
  const [historyState, setHistoryState] = useState<HistoryState>({ entries: [], index: -1 });

  // Latest committed values, readable synchronously. Several operations triggered by a single user
  // action (e.g. one highlight per selected text line, or an edit followed by a history commit) must
  // build on each other instead of overwriting each other with stale render-time closures.
  const pagesRef = useRef<PdfPageModel[]>(pages);
  const annotationsRef = useRef<Annotation[]>(annotations);
  const sourcesRef = useRef<SourceDocument[]>(sources);
  const formValuesRef = useRef<Record<string, string | boolean | string[]>>(formValues);
  const activePageIndexRef = useRef<number>(activePageIndex);
  const historyRef = useRef<HistoryState>(historyState);

  const setPages = useCallback((next: PdfPageModel[]) => {
    pagesRef.current = next;
    setPagesState(next);
  }, []);

  const setAnnotations = useCallback((next: Annotation[]) => {
    annotationsRef.current = next;
    setAnnotationsState(next);
  }, []);

  const setSources = useCallback((next: SourceDocument[]) => {
    sourcesRef.current = next;
    setSourcesState(next);
  }, []);

  const setFormValues = useCallback((next: Record<string, string | boolean | string[]>) => {
    formValuesRef.current = next;
    setFormValuesState(next);
  }, []);

  const skipActivePageScrollRef = useRef(false);
  const setActivePageIndex = useCallback((index: number, options?: { scrollIntoView?: boolean }) => {
    if (options?.scrollIntoView === false && index !== activePageIndexRef.current) skipActivePageScrollRef.current = true;
    activePageIndexRef.current = index;
    setActivePageIndexState(index);
  }, []);
  const consumeActivePageScrollSkip = useCallback(() => {
    const skip = skipActivePageScrollRef.current;
    skipActivePageScrollRef.current = false;
    return skip;
  }, []);

  const setHistory = useCallback((next: HistoryState) => {
    historyRef.current = next;
    setHistoryState(next);
  }, []);

  const history = historyState.entries;
  const historyIndex = historyState.index;

  const updateMetadata = useCallback((fields: Partial<DocumentMetadata>) => {
    setMetadata((prev) => ({ ...prev, ...fields }));
  }, []);

  const captureSnapshot = (): HistorySnapshot => ({
    pages: pagesRef.current,
    annotations: annotationsRef.current,
    activePageIndex: activePageIndexRef.current,
    sources: sourcesRef.current,
    formValues: formValuesRef.current,
  });

  // Records the current (latest committed) document state as a new undo step
  const pushHistory = useCallback(() => {
    const snapshot = captureSnapshot();
    const { entries, index } = historyRef.current;
    const current = entries[index];
    if (current && isSameSnapshot(current, snapshot)) {
      return;
    }
    const next = entries.slice(0, index + 1);
    next.push(snapshot);
    while (next.length > MAX_HISTORY) {
      next.shift();
    }
    setHistory({ entries: next, index: next.length - 1 });
  }, [setHistory]);

  const updateFormFieldValue = useCallback(
    (name: string, value: string | boolean | string[], commitHistory: boolean = false) => {
      setFormValues({ ...formValuesRef.current, [name]: value });
      if (commitHistory) {
        pushHistory();
      }
    },
    [setFormValues, pushHistory]
  );

  const commitHistorySnapshot = useCallback(() => {
    pushHistory();
  }, [pushHistory]);

  const initializeDocument = (
    name: string,
    mainSource: SourceDocument,
    parsedPages: PdfPageModel[],
    loadedAnnotations: Annotation[],
    loadedMetadata: DocumentMetadata,
    extractedFormFields: FormFieldModel[]
  ) => {
    const initialFormValues: Record<string, string | boolean | string[]> = {};
    extractedFormFields.forEach((field) => {
      initialFormValues[field.name] = field.value;
    });

    setFileName(name);
    setSources([mainSource]);
    setPages(parsedPages);
    setActivePageIndex(0);
    rangeAnchorIndexRef.current = 0;
    setSelectedPageIds(parsedPages.length > 0 ? [parsedPages[0].id] : []);
    setAnnotations(loadedAnnotations);
    setSelectedAnnotationId(null);
    setMetadata(loadedMetadata);
    setFormFields(extractedFormFields);
    setFormValues(initialFormValues);
    setHistory({ entries: [captureSnapshot()], index: 0 });
  };

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

      initializeDocument(file.name, mainSource, parsedPages, loadedAnnotations, extractedMeta, extractedFormFields);
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

      const sampleMeta: DocumentMetadata = {
        title: _lang === 'cs' ? 'Ukázková smlouva o dílo' : 'Sample Agreement',
        author: 'Richard Lipka',
        subject: _lang === 'cs' ? 'Ukázkový dokument pro PDF Studio' : 'Sample document for PDF Studio',
        keywords: 'PDF Studio, sample, contract',
        creator: 'PDF Studio',
        producer: 'PDF Studio (https://richardlipka.github.io/pdf-studio/)',
        creationDate: new Date().toISOString(),
      };

      initializeDocument('sample-contract.pdf', mainSource, parsedPages, loadedAnnotations, sampleMeta, extractedFormFields);
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

  // Rotates pages and moves their annotations along with the page content
  const rotatePages = (targetIds: Set<string>, deltaAngle: number) => {
    const currentPages = pagesRef.current;
    const rotatedById = new Map<string, PdfPageModel>();
    const updatedPages = currentPages.map((p) => {
      if (!targetIds.has(p.id)) return p;
      const rotated = rotatePage(p, deltaAngle);
      rotatedById.set(p.id, p);
      return rotated;
    });
    if (rotatedById.size === 0) return;

    const updatedAnnotations = annotationsRef.current.map((a) => {
      const original = rotatedById.get(a.pageId);
      return original ? rotateAnnotationWithPage(a, original.width, original.height, deltaAngle) : a;
    });

    setPages(updatedPages);
    setAnnotations(updatedAnnotations);
    pushHistory();
  };

  const rotatePageById = (pageId: string, deltaAngle: number) => {
    rotatePages(new Set([pageId]), deltaAngle);
  };

  const rotateSelectedPages = (deltaAngle: number) => {
    if (selectedPageIds.length === 0) return;
    rotatePages(new Set(selectedPageIds), deltaAngle);
  };

  const deletePageById = (pageId: string) => {
    const currentPages = pagesRef.current;
    if (currentPages.length <= 1) return;
    const { updatedPages, nextActiveIndex } = deletePage(currentPages, pageId);
    const updatedAnnotations = annotationsRef.current.filter((a) => a.pageId !== pageId);

    setPages(updatedPages);
    setActivePageIndex(nextActiveIndex);
    rangeAnchorIndexRef.current = nextActiveIndex;
    setSelectedPageIds(updatedPages[nextActiveIndex] ? [updatedPages[nextActiveIndex].id] : []);
    setAnnotations(updatedAnnotations);
    pushHistory();
  };

  const deleteSelectedPages = () => {
    const currentPages = pagesRef.current;
    if (currentPages.length <= 1 || selectedPageIds.length === 0) return;
    if (selectedPageIds.length >= currentPages.length) {
      // Don't delete entire document, keep at least the first
      const keepPage = currentPages[0];
      const updatedPages = [keepPage];
      const updatedAnnotations = annotationsRef.current.filter((a) => a.pageId === keepPage.id);
      setPages(updatedPages);
      setActivePageIndex(0);
      rangeAnchorIndexRef.current = 0;
      setSelectedPageIds([keepPage.id]);
      setAnnotations(updatedAnnotations);
      pushHistory();
      return;
    }

    const deleteSet = new Set(selectedPageIds);
    const updatedPages = currentPages.filter((p) => !deleteSet.has(p.id));
    const updatedAnnotations = annotationsRef.current.filter((a) => !deleteSet.has(a.pageId));
    const nextActive = Math.max(0, Math.min(activePageIndexRef.current, updatedPages.length - 1));

    setPages(updatedPages);
    setActivePageIndex(nextActive);
    rangeAnchorIndexRef.current = nextActive;
    setSelectedPageIds(updatedPages[nextActive] ? [updatedPages[nextActive].id] : []);
    setAnnotations(updatedAnnotations);
    pushHistory();
  };

  const reorderPagesByIndex = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    const updated = reorderPages(pagesRef.current, fromIndex, toIndex);
    setPages(updated);
    setActivePageIndex(toIndex);
    rangeAnchorIndexRef.current = toIndex;
    pushHistory();
  };

  const insertPages = (
    newPages: PdfPageModel[],
    position: InsertPosition,
    newSource?: SourceDocument,
    newAnnotations?: Annotation[]
  ) => {
    if (newAnnotations && newAnnotations.length > 0) {
      setAnnotations([...annotationsRef.current, ...newAnnotations]);
    }
    if (newSource) {
      // The new source must be part of the same history step, otherwise undo/redo would restore
      // pages that point to a missing source document
      setSources([...sourcesRef.current, newSource]);
    }
    const { pages: updated, newActiveIndex } = insertPagesAtPosition(
      pagesRef.current,
      newPages,
      position,
      activePageIndexRef.current
    );
    setPages(updated);
    setActivePageIndex(newActiveIndex);
    rangeAnchorIndexRef.current = newActiveIndex;
    setSelectedPageIds(newPages.map((p) => p.id));
    pushHistory();
  };

  const addAnnotation = (ann: Annotation) => {
    setAnnotations([...annotationsRef.current, ann]);
    setSelectedAnnotationId(ann.id);
    pushHistory();
  };

  const updateAnnotation = (ann: Annotation, recordHistory: boolean = false) => {
    const current = annotationsRef.current;
    if (!current.some((a) => a.id === ann.id)) return;
    setAnnotations(current.map((a) => (a.id === ann.id ? ann : a)));
    if (recordHistory) {
      pushHistory();
    }
  };

  const deleteAnnotation = (id: string) => {
    setAnnotations(annotationsRef.current.filter((a) => a.id !== id));
    setSelectedAnnotationId((prev) => (prev === id ? null : prev));
    pushHistory();
  };

  const restoreSnapshot = (snapshot: HistorySnapshot) => {
    setPages(snapshot.pages);
    setAnnotations(snapshot.annotations);
    setActivePageIndex(Math.min(snapshot.activePageIndex, Math.max(0, snapshot.pages.length - 1)));
    rangeAnchorIndexRef.current = snapshot.activePageIndex;
    setSelectedAnnotationId(null);
    setFormValues(snapshot.formValues);
    if (!sameSourceBuffers(snapshot.sources, sourcesRef.current)) {
      // Only binary edits need the PDF documents re-parsed and pages re-rendered
      clearPdfCache();
      const restoredAt = Date.now();
      setSources(snapshot.sources.map((s) => ({ ...s, updatedAt: restoredAt })));
    }
  };

  const undo = () => {
    const { entries, index } = historyRef.current;
    if (index <= 0) return;
    const targetIndex = index - 1;
    restoreSnapshot(entries[targetIndex]);
    setHistory({ entries, index: targetIndex });
    logger.info('system', `Krok Zpět (Undo): obnoven stav #${targetIndex + 1}`);
  };

  const redo = () => {
    const { entries, index } = historyRef.current;
    if (index >= entries.length - 1) return;
    const targetIndex = index + 1;
    restoreSnapshot(entries[targetIndex]);
    setHistory({ entries, index: targetIndex });
    logger.info('system', `Krok Vpřed (Redo): obnoven stav #${targetIndex + 1}`);
  };

  // Resolves the source PDF and the page index inside it for a page of the edited document
  const resolvePageSource = (pageIndex: number) => {
    const targetPage = pagesRef.current[pageIndex];
    if (!targetPage) {
      return { error: 'Stránka nenalezena' as const };
    }
    const sourceDoc = sourcesRef.current.find((s) => s.id === targetPage.sourceDocId);
    const sourcePageIndex =
      targetPage.originalPageIndex !== undefined ? targetPage.originalPageIndex : pageIndex;
    return { targetPage, sourceDoc, sourcePageIndex };
  };

  // Replaces a source document's bytes and records the edit as one undo step
  const commitSourceBytes = (sourceId: string, updatedPdfBytes: ArrayBuffer) => {
    const updatedSources = sourcesRef.current.map((s) =>
      s.id === sourceId ? { ...s, arrayBuffer: updatedPdfBytes, updatedAt: Date.now() } : s
    );
    clearPdfCache();
    setSources(updatedSources);
    pushHistory();
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
      pageIndex = activePageIndexRef.current,
      replaceAllPages = false,
      matchCase = true,
    } = options;

    const resolved = resolvePageSource(pageIndex);
    if ('error' in resolved) {
      return { success: false, totalReplaced: 0, error: resolved.error };
    }
    const { sourceDoc, sourcePageIndex } = resolved;
    if (!sourceDoc || !sourceDoc.arrayBuffer) {
      return {
        success: false,
        totalReplaced: 0,
        error: 'Zdrojový PDF dokument nenalezen nebo je rastrovým obrázkem',
      };
    }

    const result = replaceAllPages
      ? await replaceTextInAllPagesContentStream(sourceDoc.arrayBuffer, searchText, replaceText, { matchCase })
      : await replaceTextInPageContentStream(sourceDoc.arrayBuffer, sourcePageIndex, searchText, replaceText, {
          matchCase,
        });

    if (result.occurrencesReplaced > 0) {
      commitSourceBytes(sourceDoc.id, result.updatedPdfBytes);
      return { success: true, totalReplaced: result.occurrencesReplaced };
    }

    if (result.error) {
      return { success: false, totalReplaced: 0, error: result.error };
    }

    return { success: false, totalReplaced: 0 };
  };

  const getPageStream = async (
    pageIndex: number = activePageIndexRef.current
  ): Promise<{ streamText: string; streamCount: number; isEncrypted?: boolean; error?: string }> => {
    const resolved = resolvePageSource(pageIndex);
    if ('error' in resolved) {
      return { streamText: '', streamCount: 0, error: resolved.error };
    }
    const { sourceDoc, sourcePageIndex } = resolved;
    if (!sourceDoc || !sourceDoc.arrayBuffer) {
      return { streamText: '', streamCount: 0, error: 'Zdrojový PDF dokument nenalezen' };
    }
    return getPageContentStream(sourceDoc.arrayBuffer, sourcePageIndex);
  };

  const applyPageContentStreamEdit = async (
    newStreamContent: string,
    pageIndex: number = activePageIndexRef.current
  ): Promise<{ success: boolean; updatedStream?: string; error?: string }> => {
    const resolved = resolvePageSource(pageIndex);
    if ('error' in resolved) {
      return { success: false, error: resolved.error };
    }
    const { sourceDoc, sourcePageIndex } = resolved;
    if (!sourceDoc || !sourceDoc.arrayBuffer) {
      return { success: false, error: 'Zdrojový PDF dokument nenalezen' };
    }
    const result = await updatePageContentStream(sourceDoc.arrayBuffer, sourcePageIndex, newStreamContent);
    if (result.error) {
      return { success: false, error: result.error };
    }

    commitSourceBytes(sourceDoc.id, result.updatedPdfBytes);
    return { success: true, updatedStream: result.updatedStream };
  };

  const applyStreamSegmentEdit = async (
    originalSegment: string,
    newSegment: string,
    pageIndex: number = activePageIndexRef.current
  ): Promise<{ success: boolean; updatedStream?: string; error?: string }> => {
    const resolved = resolvePageSource(pageIndex);
    if ('error' in resolved) {
      return { success: false, error: resolved.error };
    }
    const { sourceDoc, sourcePageIndex } = resolved;
    if (!sourceDoc || !sourceDoc.arrayBuffer) {
      return { success: false, error: 'Zdrojový PDF dokument nenalezen' };
    }
    const result = await updateStreamSegmentInPage(
      sourceDoc.arrayBuffer,
      sourcePageIndex,
      originalSegment,
      newSegment
    );
    if (result.error) {
      return { success: false, error: result.error };
    }

    commitSourceBytes(sourceDoc.id, result.updatedPdfBytes);
    return { success: true, updatedStream: result.updatedStream };
  };

  const getPageImagesList = async (
    pageIndex: number = activePageIndexRef.current
  ): Promise<{ images: PageImageInfo[]; error?: string }> => {
    const resolved = resolvePageSource(pageIndex);
    if ('error' in resolved) {
      return { images: [], error: resolved.error };
    }
    const { sourceDoc, sourcePageIndex } = resolved;
    if (!sourceDoc || !sourceDoc.arrayBuffer) {
      return { images: [], error: 'Zdrojový PDF dokument nenalezen' };
    }
    return getPageImages(sourceDoc.arrayBuffer, sourcePageIndex);
  };

  const removeMultiplePageElements = async (
    segmentIds: string[],
    imageNames: string[],
    pageIndex: number = activePageIndexRef.current,
    expectedContents?: Record<string, string>
  ): Promise<{ success: boolean; removedCount: number; updatedStream?: string; error?: string }> => {
    const resolved = resolvePageSource(pageIndex);
    if ('error' in resolved) {
      return { success: false, removedCount: 0, error: resolved.error };
    }
    const { sourceDoc, sourcePageIndex } = resolved;
    if (!sourceDoc || !sourceDoc.arrayBuffer) {
      return { success: false, removedCount: 0, error: 'Zdrojový PDF dokument nenalezen' };
    }

    const result = await removeMultipleElementsFromPage(
      sourceDoc.arrayBuffer,
      sourcePageIndex,
      segmentIds,
      imageNames,
      expectedContents
    );

    if (result.error) {
      return { success: false, removedCount: 0, error: result.error };
    }

    commitSourceBytes(sourceDoc.id, result.updatedPdfBytes);
    return { success: true, removedCount: result.removedCount, updatedStream: result.updatedStream };
  };

  const removePageImage = async (
    imageName: string,
    pageIndex: number = activePageIndexRef.current
  ): Promise<{ success: boolean; error?: string }> => {
    const res = await removeMultiplePageElements([], [imageName], pageIndex);
    return { success: res.success, error: res.error };
  };

  const removePageBlock = async (
    segment: StreamSegment,
    pageIndex: number = activePageIndexRef.current
  ): Promise<{ success: boolean; updatedStream?: string; error?: string }> => {
    const res = await removeMultiplePageElements([segment.id], [], pageIndex, {
      [segment.id]: segment.rawContent,
    });
    return { success: res.success, updatedStream: res.updatedStream, error: res.error };
  };

  const applyBlockTextEdit = async (
    segmentId: string,
    newText: string,
    pageIndex: number = activePageIndexRef.current
  ): Promise<{ success: boolean; updatedStream?: string; fontSubstituted?: boolean; error?: string }> => {
    const resolved = resolvePageSource(pageIndex);
    if ('error' in resolved) {
      return { success: false, error: resolved.error };
    }
    const { targetPage, sourceDoc, sourcePageIndex } = resolved;
    if (!sourceDoc || !sourceDoc.arrayBuffer) {
      return { success: false, error: 'Zdrojový PDF dokument nenalezen' };
    }
    const model = await getPageTextModel(sourceDoc, targetPage);
    if (!model?.aligned) {
      return {
        success: false,
        error: 'Text této stránky nelze spolehlivě namapovat na obsah PDF. Použijte editor kódu nebo Vizuální přepis.',
      };
    }
    const result = await replaceTextBlockContent(sourceDoc.arrayBuffer, sourcePageIndex, model, segmentId, newText);
    if (result.error) {
      return { success: false, error: result.error };
    }
    commitSourceBytes(sourceDoc.id, result.updatedPdfBytes);
    return { success: true, updatedStream: result.updatedStream, fontSubstituted: result.fontSubstituted };
  };

  const applyLineTextEdit = async (
    lineId: string,
    newText: string,
    pageIndex: number = activePageIndexRef.current
  ): Promise<{ success: boolean; fontSubstituted?: boolean; error?: string }> => {
    const resolved = resolvePageSource(pageIndex);
    if ('error' in resolved) return { success: false, error: resolved.error };
    const { targetPage, sourceDoc, sourcePageIndex } = resolved;
    if (!sourceDoc || !sourceDoc.arrayBuffer) return { success: false, error: 'Zdrojový PDF dokument nenalezen' };
    const model = await getPageTextModel(sourceDoc, targetPage);
    if (!model?.aligned) {
      return { success: false, error: 'Text této stránky nelze spolehlivě namapovat na obsah PDF.' };
    }
    const result = await replaceTextLineContent(sourceDoc.arrayBuffer, sourcePageIndex, model, lineId, newText);
    if (result.error) return { success: false, error: result.error };
    commitSourceBytes(sourceDoc.id, result.updatedPdfBytes);
    return { success: true, fontSubstituted: result.fontSubstituted };
  };

  const replacePageImage = async (
    imageName: string,
    fileOrBytes: File | Blob | ArrayBuffer | Uint8Array,
    mimeType?: 'image/png' | 'image/jpeg' | 'image/webp',
    pageIndex: number = activePageIndexRef.current
  ): Promise<{ success: boolean; error?: string }> => {
    const resolved = resolvePageSource(pageIndex);
    if ('error' in resolved) return { success: false, error: resolved.error };
    const { sourceDoc, sourcePageIndex } = resolved;
    if (!sourceDoc || !sourceDoc.arrayBuffer) return { success: false, error: 'Zdrojový PDF dokument nenalezen' };

    try {
      let buffer: ArrayBuffer | Uint8Array;
      let effectiveMime = mimeType || 'image/png';

      if (fileOrBytes instanceof File || fileOrBytes instanceof Blob) {
        effectiveMime = (fileOrBytes.type as any) || effectiveMime;
        if (effectiveMime === 'image/webp') {
          const blobUrl = URL.createObjectURL(fileOrBytes);
          const img = new Image();
          try {
            await new Promise<void>((resolve, reject) => {
              img.onload = () => resolve();
              img.onerror = reject;
              img.src = blobUrl;
            });
          } finally {
            URL.revokeObjectURL(blobUrl);
          }

          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth || img.width;
          canvas.height = img.naturalHeight || img.height;
          const ctx = canvas.getContext('2d');
          if (ctx) ctx.drawImage(img, 0, 0);
          const pngBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
          if (!pngBlob) throw new Error('Konverze WebP na PNG selhala.');
          buffer = await pngBlob.arrayBuffer();
          effectiveMime = 'image/png';
        } else {
          buffer = await fileOrBytes.arrayBuffer();
        }
      } else {
        buffer = fileOrBytes;
      }

      const res = await replaceImageOnPage(
        sourceDoc.arrayBuffer,
        sourcePageIndex,
        imageName,
        buffer,
        effectiveMime as any
      );

      if (res.error) {
        return { success: false, error: res.error };
      }

      commitSourceBytes(sourceDoc.id, res.updatedPdfBytes);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) };
    }
  };

  const exportPageImage = async (
    imageName: string,
    pageIndex: number = activePageIndexRef.current,
    canvasEl?: HTMLCanvasElement | null,
    pdfBox?: { x: number; y: number; width: number; height: number }
  ): Promise<{ success: boolean; error?: string }> => {
    const resolved = resolvePageSource(pageIndex);
    if ('error' in resolved) return { success: false, error: resolved.error };
    const { targetPage, sourceDoc, sourcePageIndex } = resolved;
    if (!sourceDoc || !sourceDoc.arrayBuffer) return { success: false, error: 'Zdrojový PDF dokument nenalezen' };

    const cleanName = imageName.replace(/^\//, '');

    try {
      // 1. If canvasEl and pdfBox are provided, crop directly from hardware-rendered page canvas
      if (canvasEl && pdfBox && pdfBox.width > 2 && pdfBox.height > 2) {
        const scaleX = canvasEl.width / targetPage.width;
        const scaleY = canvasEl.height / targetPage.height;
        const sx = Math.max(0, Math.round(pdfBox.x * scaleX));
        const sy = Math.max(0, Math.round(pdfBox.y * scaleY));
        const sw = Math.min(canvasEl.width - sx, Math.round(pdfBox.width * scaleX));
        const sh = Math.min(canvasEl.height - sy, Math.round(pdfBox.height * scaleY));

        if (sw > 0 && sh > 0) {
          const offscreen = document.createElement('canvas');
          offscreen.width = sw;
          offscreen.height = sh;
          const ctx = offscreen.getContext('2d');
          if (ctx) {
            ctx.drawImage(canvasEl, sx, sy, sw, sh, 0, 0, sw, sh);
            const blob = await new Promise<Blob | null>((resolve) => offscreen.toBlob(resolve, 'image/png'));
            if (blob) {
              downloadBlob(blob, `${cleanName || 'image'}.png`);
              return { success: true };
            }
          }
        }
      }

      // 2. Stream-based extraction fallback
      const extRes = await extractImageBytesFromPdf(sourceDoc.arrayBuffer, sourcePageIndex, cleanName);
      if (extRes.imageBytes) {
        const mime = extRes.mimeType || 'application/octet-stream';
        const ext = extRes.extension || 'bin';
        downloadBlob(new Blob([extRes.imageBytes as unknown as BlobPart], { type: mime }), `${cleanName || 'image'}.${ext}`);
        return { success: true };
      }

      return { success: false, error: extRes.error || 'Obrázek se nepodařilo extrahovat' };
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) };
    }
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

  const flattenAndDownload = async (
    options: FlattenOptions,
    onProgress?: (done: number, total: number) => void
  ): Promise<boolean> => {
    if (pages.length === 0) return false;
    setIsSaving(true);
    try {
      const baseName = fileName.replace(/\.pdf$/i, '');
      const outName = `${baseName}-flattened.pdf`;
      // Forms are flattened and annotations get appearance streams, so the render includes them
      const exported = await exportEditedPdf(
        sources,
        pages,
        annotations,
        outName,
        undefined,
        metadata,
        formValues,
        'flatten',
        false
      );
      const flattened = await flattenPdfToImages(exported, options, metadata, onProgress);
      downloadBlob(new Blob([flattened as unknown as BlobPart], { type: 'application/pdf' }), outName);
      return true;
    } catch (e: any) {
      logger.error('save', `Zploštění dokumentu na obrázky selhalo: ${e?.message || e}`, e);
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

      // 1. Generate base edited PDF (in memory only, the unsigned intermediate must not be downloaded)
      const baseBytes = await exportEditedPdf(
        sources,
        pages,
        annotations,
        outName,
        rasterSettings,
        metadata,
        formValues,
        'interactive',
        false
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
      downloadBlob(new Blob([signResult.signedPdfBytes], { type: 'application/pdf' }), outName);

      return true;
    } catch (e: any) {
      logger.error('crypto', `Chyba při digitálním podepisování a stahování PDF: ${e?.message || e}`, e);
      console.error('Failed to digitally sign PDF:', e);
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  // Keyboard shortcut listener for Ctrl+Z / Ctrl+Y / Delete / PageUp / PageDown / Arrows / Ctrl+A.
  // The listener is registered once and always dispatches to the handler from the latest render,
  // so it never acts on stale annotations, pages or history.
  const handleKeyDownRef = useRef<(e: KeyboardEvent) => void>(() => {});
  handleKeyDownRef.current = (e: KeyboardEvent) => {
    const targetEl = e.target as HTMLElement | null;
    if (
      targetEl?.tagName === 'INPUT' ||
      targetEl?.tagName === 'TEXTAREA' ||
      targetEl?.tagName === 'SELECT' ||
      targetEl?.isContentEditable ||
      targetEl?.closest?.('[contenteditable="true"]')
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

  useEffect(() => {
    const listener = (e: KeyboardEvent) => handleKeyDownRef.current(e);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

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
    replacePageImage,
    exportPageImage,
    removePageImage,
    removePageBlock,
    removeMultiplePageElements,
    applyBlockTextEdit,
    applyLineTextEdit,
    formFields,
    formValues,
    updateFormFieldValue,
    hasFormFields: formFields.length > 0,
    undo,
    redo,
    commitHistorySnapshot,
    saveAndDownload,
    flattenAndDownload,
    consumeActivePageScrollSkip,
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
