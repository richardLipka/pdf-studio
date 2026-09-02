import React, { createContext, useContext, useState, useEffect } from 'react';
import { ToolType, ShapeType, EditorTab } from '../types/annotations';
import { SignatureStamp, StampExportPackage } from '../types/stamp';
import { RasterizationSettings, DEFAULT_RASTERIZATION_SETTINGS } from '../types/document';

export type SignatureModalTab = 'draw' | 'type' | 'upload' | 'saved' | 'certificate';

interface EditorContextType {
  activeTab: EditorTab;
  setActiveTab: (tab: EditorTab) => void;
  activeTool: ToolType;
  setActiveTool: (tool: ToolType) => void;
  
  // Styles
  strokeColor: string;
  setStrokeColor: (color: string) => void;
  highlightColor: string;
  setHighlightColor: (color: string) => void;
  textColor: string;
  setTextColor: (color: string) => void;
  fillColor: string;
  setFillColor: (color: string) => void;
  strokeWidth: number;
  setStrokeWidth: (width: number) => void;
  fontSize: number;
  setFontSize: (size: number) => void;
  fontFamily: string;
  setFontFamily: (font: string) => void;
  opacity: number;
  setOpacity: (op: number) => void;
  selectedShape: ShapeType;
  setSelectedShape: (shape: ShapeType) => void;

  // Review & Notes Panel (Right sidebar)
  isNotesPanelOpen: boolean;
  setIsNotesPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  toggleNotesPanel: () => void;

  // Modals & Panels
  isSignatureModalOpen: boolean;
  setIsSignatureModalOpen: (open: boolean) => void;
  signatureModalInitialTab: SignatureModalTab;
  setSignatureModalInitialTab: (tab: SignatureModalTab) => void;
  openSignatureModal: (initialTab?: SignatureModalTab) => void;
  isAddPageModalOpen: boolean;
  setIsAddPageModalOpen: (open: boolean) => void;
  isDeleteConfirmModalOpen: boolean;
  setIsDeleteConfirmModalOpen: (open: boolean) => void;
  deleteTargetPageId: string | null;
  setDeleteTargetPageId: (pageId: string | null) => void;
  deleteMode: 'single' | 'multiple';
  setDeleteMode: (mode: 'single' | 'multiple') => void;
  isLogModalOpen: boolean;
  setIsLogModalOpen: (open: boolean) => void;
  toggleLogModal: () => void;
  isSettingsModalOpen: boolean;
  setIsSettingsModalOpen: (open: boolean) => void;
  toggleSettingsModal: () => void;
  isMetadataModalOpen: boolean;
  setIsMetadataModalOpen: (open: boolean) => void;
  toggleMetadataModal: () => void;
  isStreamReplaceModalOpen: boolean;
  setIsStreamReplaceModalOpen: (open: boolean) => void;
  toggleStreamReplaceModal: () => void;
  isRemoveElementsModalOpen: boolean;
  setIsRemoveElementsModalOpen: (open: boolean) => void;
  toggleRemoveElementsModal: () => void;
  isExportFormModalOpen: boolean;
  setIsExportFormModalOpen: (open: boolean) => void;
  toggleExportFormModal: () => void;
  streamReplaceTargetText: string;
  setStreamReplaceTargetText: (text: string) => void;
  streamReplaceTargetPosition: { x: number; y: number } | null;
  setStreamReplaceTargetPosition: (pos: { x: number; y: number } | null) => void;

  // Edit & Stream Right-Side Panel
  isEditSidePanelOpen: boolean;
  setIsEditSidePanelOpen: (open: boolean) => void;
  editSidePanelTab: 'remove' | 'stream';
  setEditSidePanelTab: (tab: 'remove' | 'stream') => void;
  toggleEditSidePanel: (tab?: 'remove' | 'stream') => void;
  selectedStreamBlockId: string | null;
  setSelectedStreamBlockId: (id: string | null) => void;

  // Rasterization Settings
  rasterSettings: RasterizationSettings;
  setRasterSettings: React.Dispatch<React.SetStateAction<RasterizationSettings>>;
  resetRasterSettings: () => void;

  // Stamps & Signatures Library
  stamps: SignatureStamp[];
  addStamp: (stampData: { title: string; imageDataUrl: string; width?: number; height?: number }) => void;
  removeStamp: (id: string) => void;
  exportStampsToJson: () => void;
  importStampsFromJson: (file: File) => Promise<{ success: boolean; count: number; error?: string }>;
}

const EditorContext = createContext<EditorContextType | null>(null);

const STAMPS_STORAGE_KEY = 'pdf_studio_stamps_library_v2';
const LEGACY_SIGS_KEY = 'pdf_studio_saved_sigs_v1';
const RASTER_SETTINGS_STORAGE_KEY = 'pdf_studio_raster_settings_v1';

export const EditorProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeTab, setActiveTab] = useState<EditorTab>('review');
  const [activeTool, setActiveTool] = useState<ToolType>('select');
  const [strokeColor, setStrokeColor] = useState<string>('#0284c7');
  const [highlightColor, setHighlightColor] = useState<string>('#fde047');
  const [textColor, setTextColor] = useState<string>('#0f172a');
  const [fillColor, setFillColor] = useState<string>('transparent');
  const [strokeWidth, setStrokeWidth] = useState<number>(3);
  const [fontSize, setFontSize] = useState<number>(14);
  const [fontFamily, setFontFamily] = useState<string>('Inter');
  const [opacity, setOpacity] = useState<number>(1.0);
  const [selectedShape, setSelectedShape] = useState<ShapeType>('rectangle');

  // Review & Notes Panel (Right side)
  const [isNotesPanelOpen, setIsNotesPanelOpen] = useState<boolean>(false);

  const toggleNotesPanel = () => {
    setIsNotesPanelOpen((prev) => !prev);
  };

  // Modals
  const [isSignatureModalOpen, setIsSignatureModalOpen] = useState<boolean>(false);
  const [signatureModalInitialTab, setSignatureModalInitialTab] = useState<SignatureModalTab>('draw');

  const openSignatureModal = (initialTab: SignatureModalTab = 'draw') => {
    setSignatureModalInitialTab(initialTab);
    setIsSignatureModalOpen(true);
  };

  const [isAddPageModalOpen, setIsAddPageModalOpen] = useState<boolean>(false);
  const [isDeleteConfirmModalOpen, setIsDeleteConfirmModalOpen] = useState<boolean>(false);
  const [deleteTargetPageId, setDeleteTargetPageId] = useState<string | null>(null);
  const [deleteMode, setDeleteMode] = useState<'single' | 'multiple'>('single');
  const [isLogModalOpen, setIsLogModalOpen] = useState<boolean>(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState<boolean>(false);
  const [isMetadataModalOpen, setIsMetadataModalOpen] = useState<boolean>(false);
  const [isStreamReplaceModalOpen, setIsStreamReplaceModalOpenState] = useState<boolean>(false);
  const [isRemoveElementsModalOpen, setIsRemoveElementsModalOpenState] = useState<boolean>(false);
  const [isExportFormModalOpen, setIsExportFormModalOpen] = useState<boolean>(false);
  const [streamReplaceTargetText, setStreamReplaceTargetText] = useState<string>('');
  const [streamReplaceTargetPosition, setStreamReplaceTargetPosition] = useState<{ x: number; y: number } | null>(null);

  // Edit & Stream Right-Side Panel state
  const [isEditSidePanelOpen, setIsEditSidePanelOpen] = useState<boolean>(false);
  const [editSidePanelTab, setEditSidePanelTab] = useState<'remove' | 'stream'>('remove');
  const [selectedStreamBlockId, setSelectedStreamBlockId] = useState<string | null>(null);

  const toggleEditSidePanel = (tab?: 'remove' | 'stream') => {
    if (tab) {
      setEditSidePanelTab(tab);
      setIsEditSidePanelOpen(true);
    } else {
      setIsEditSidePanelOpen((prev) => !prev);
    }
  };

  const setIsStreamReplaceModalOpen = (open: boolean) => {
    setIsStreamReplaceModalOpenState(open);
    if (open) {
      setEditSidePanelTab('stream');
      setIsEditSidePanelOpen(true);
    } else if (!isRemoveElementsModalOpen) {
      setIsEditSidePanelOpen(false);
    }
  };

  const setIsRemoveElementsModalOpen = (open: boolean) => {
    setIsRemoveElementsModalOpenState(open);
    if (open) {
      setEditSidePanelTab('remove');
      setIsEditSidePanelOpen(true);
    } else if (!isStreamReplaceModalOpen) {
      setIsEditSidePanelOpen(false);
    }
  };

  const toggleLogModal = () => {
    setIsLogModalOpen((prev) => !prev);
  };

  const toggleSettingsModal = () => {
    setIsSettingsModalOpen((prev) => !prev);
  };

  const toggleMetadataModal = () => {
    setIsMetadataModalOpen((prev) => !prev);
  };

  const toggleStreamReplaceModal = () => {
    if (isEditSidePanelOpen && editSidePanelTab === 'stream') {
      setIsEditSidePanelOpen(false);
      setIsStreamReplaceModalOpenState(false);
    } else {
      setEditSidePanelTab('stream');
      setIsEditSidePanelOpen(true);
      setIsStreamReplaceModalOpenState(true);
    }
  };

  const toggleRemoveElementsModal = () => {
    if (isEditSidePanelOpen && editSidePanelTab === 'remove') {
      setIsEditSidePanelOpen(false);
      setIsRemoveElementsModalOpenState(false);
    } else {
      setEditSidePanelTab('remove');
      setIsEditSidePanelOpen(true);
      setIsRemoveElementsModalOpenState(true);
    }
  };

  const toggleExportFormModal = () => {
    setIsExportFormModalOpen((prev) => !prev);
  };

  // Rasterization Settings State (persisted in localStorage)
  const [rasterSettings, setRasterSettings] = useState<RasterizationSettings>(() => {
    try {
      const saved = localStorage.getItem(RASTER_SETTINGS_STORAGE_KEY);
      if (saved) {
        return { ...DEFAULT_RASTERIZATION_SETTINGS, ...JSON.parse(saved) };
      }
    } catch {
      // ignore
    }
    return DEFAULT_RASTERIZATION_SETTINGS;
  });

  useEffect(() => {
    try {
      localStorage.setItem(RASTER_SETTINGS_STORAGE_KEY, JSON.stringify(rasterSettings));
    } catch (e) {
      console.warn('Failed to save raster settings to localStorage', e);
    }
  }, [rasterSettings]);

  const resetRasterSettings = () => {
    setRasterSettings(DEFAULT_RASTERIZATION_SETTINGS);
  };

  // Stamps library state
  const [stamps, setStamps] = useState<SignatureStamp[]>(() => {
    try {
      const item = localStorage.getItem(STAMPS_STORAGE_KEY);
      if (item) return JSON.parse(item);

      // Migrate legacy string array if exists
      const legacy = localStorage.getItem(LEGACY_SIGS_KEY);
      if (legacy) {
        const parsedLegacy = JSON.parse(legacy) as string[];
        return parsedLegacy.map((dataUrl, idx) => ({
          id: `stamp_migrated_${idx}_${Date.now()}`,
          title: `Razítko / Stamp ${idx + 1}`,
          imageDataUrl: dataUrl,
          createdAt: Date.now(),
        }));
      }
      return [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STAMPS_STORAGE_KEY, JSON.stringify(stamps));
    } catch (e) {
      console.warn('Failed to save stamps to localStorage', e);
    }
  }, [stamps]);

  const addStamp = ({
    title,
    imageDataUrl,
    width,
    height,
  }: {
    title: string;
    imageDataUrl: string;
    width?: number;
    height?: number;
  }) => {
    const newStamp: SignatureStamp = {
      id: `stamp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      title: title.trim() || `Razítko / Stamp ${stamps.length + 1}`,
      imageDataUrl,
      width,
      height,
      createdAt: Date.now(),
    };
    setStamps((prev) => [newStamp, ...prev]);
  };

  const removeStamp = (id: string) => {
    setStamps((prev) => prev.filter((s) => s.id !== id));
  };

  const exportStampsToJson = () => {
    const pkg: StampExportPackage = {
      app: 'PDF Studio',
      version: '2.0.0',
      exportedAt: new Date().toISOString(),
      stampsCount: stamps.length,
      stamps,
    };

    const jsonStr = JSON.stringify(pkg, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = `pdf-studio-stamps-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(downloadUrl), 2000);
  };

  const importStampsFromJson = (file: File): Promise<{ success: boolean; count: number; error?: string }> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const content = reader.result as string;
          const parsed = JSON.parse(content);
          
          let importedStamps: SignatureStamp[] = [];
          if (Array.isArray(parsed)) {
            // Raw array format
            importedStamps = parsed;
          } else if (parsed.stamps && Array.isArray(parsed.stamps)) {
            // Standard StampExportPackage
            importedStamps = parsed.stamps;
          }

          if (importedStamps.length === 0) {
            resolve({ success: false, count: 0, error: 'No stamps found in JSON' });
            return;
          }

          // Filter valid stamps
          const valid = importedStamps.filter((s) => s.imageDataUrl && typeof s.imageDataUrl === 'string');

          setStamps((prev) => {
            const existingIds = new Set(prev.map((s) => s.id));
            const newUnique = valid.map((s) => ({
              ...s,
              id: existingIds.has(s.id) ? `stamp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` : s.id,
              title: s.title || 'Imported Stamp',
              createdAt: s.createdAt || Date.now(),
            }));
            return [...newUnique, ...prev];
          });

          resolve({ success: true, count: valid.length });
        } catch (err) {
          resolve({ success: false, count: 0, error: String(err) });
        }
      };
      reader.onerror = () => resolve({ success: false, count: 0, error: 'File read error' });
      reader.readAsText(file);
    });
  };

  const value = {
    activeTab,
    setActiveTab,
    activeTool,
    setActiveTool,
    strokeColor,
    setStrokeColor,
    highlightColor,
    setHighlightColor,
    textColor,
    setTextColor,
    fillColor,
    setFillColor,
    strokeWidth,
    setStrokeWidth,
    fontSize,
    setFontSize,
    fontFamily,
    setFontFamily,
    opacity,
    setOpacity,
    selectedShape,
    setSelectedShape,
    isNotesPanelOpen,
    setIsNotesPanelOpen,
    toggleNotesPanel,
    isSignatureModalOpen,
    setIsSignatureModalOpen,
    signatureModalInitialTab,
    setSignatureModalInitialTab,
    openSignatureModal,
    isAddPageModalOpen,
    setIsAddPageModalOpen,
    isDeleteConfirmModalOpen,
    setIsDeleteConfirmModalOpen,
    deleteTargetPageId,
    setDeleteTargetPageId,
    deleteMode,
    setDeleteMode,
    isLogModalOpen,
    setIsLogModalOpen,
    toggleLogModal,
    isSettingsModalOpen,
    setIsSettingsModalOpen,
    toggleSettingsModal,
    isMetadataModalOpen,
    setIsMetadataModalOpen,
    toggleMetadataModal,
    isStreamReplaceModalOpen,
    setIsStreamReplaceModalOpen,
    toggleStreamReplaceModal,
    isRemoveElementsModalOpen,
    setIsRemoveElementsModalOpen,
    toggleRemoveElementsModal,
    isExportFormModalOpen,
    setIsExportFormModalOpen,
    toggleExportFormModal,
    streamReplaceTargetText,
    setStreamReplaceTargetText,
    streamReplaceTargetPosition,
    setStreamReplaceTargetPosition,
    isEditSidePanelOpen,
    setIsEditSidePanelOpen,
    editSidePanelTab,
    setEditSidePanelTab,
    toggleEditSidePanel,
    selectedStreamBlockId,
    setSelectedStreamBlockId,
    rasterSettings,
    setRasterSettings,
    resetRasterSettings,
    stamps,
    addStamp,
    removeStamp,
    exportStampsToJson,
    importStampsFromJson,
  };

  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
};

export const useEditor = (): EditorContextType => {
  const context = useContext(EditorContext);
  if (!context) {
    throw new Error('useEditor must be used within an EditorProvider');
  }
  return context;
};
