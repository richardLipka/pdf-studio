import React, { createContext, useContext, useState, useEffect } from 'react';
import { ToolType, ShapeType } from '../types/annotations';
import { SignatureStamp, StampExportPackage } from '../types/stamp';

interface EditorContextType {
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
  opacity: number;
  setOpacity: (op: number) => void;
  selectedShape: ShapeType;
  setSelectedShape: (shape: ShapeType) => void;

  // Modals
  isSignatureModalOpen: boolean;
  setIsSignatureModalOpen: (open: boolean) => void;
  isAddPageModalOpen: boolean;
  setIsAddPageModalOpen: (open: boolean) => void;
  isDeleteConfirmModalOpen: boolean;
  setIsDeleteConfirmModalOpen: (open: boolean) => void;
  deleteTargetPageId: string | null;
  setDeleteTargetPageId: (pageId: string | null) => void;
  deleteMode: 'single' | 'multiple';
  setDeleteMode: (mode: 'single' | 'multiple') => void;

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

export const EditorProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeTool, setActiveTool] = useState<ToolType>('select');
  const [strokeColor, setStrokeColor] = useState<string>('#0284c7');
  const [highlightColor, setHighlightColor] = useState<string>('#facc15');
  const [textColor, setTextColor] = useState<string>('#0f172a');
  const [fillColor, setFillColor] = useState<string>('transparent');
  const [strokeWidth, setStrokeWidth] = useState<number>(3);
  const [fontSize, setFontSize] = useState<number>(14);
  const [opacity, setOpacity] = useState<number>(1.0);
  const [selectedShape, setSelectedShape] = useState<ShapeType>('rectangle');

  // Modals
  const [isSignatureModalOpen, setIsSignatureModalOpen] = useState<boolean>(false);
  const [isAddPageModalOpen, setIsAddPageModalOpen] = useState<boolean>(false);
  const [isDeleteConfirmModalOpen, setIsDeleteConfirmModalOpen] = useState<boolean>(false);
  const [deleteTargetPageId, setDeleteTargetPageId] = useState<string | null>(null);
  const [deleteMode, setDeleteMode] = useState<'single' | 'multiple'>('single');

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
    opacity,
    setOpacity,
    selectedShape,
    setSelectedShape,
    isSignatureModalOpen,
    setIsSignatureModalOpen,
    isAddPageModalOpen,
    setIsAddPageModalOpen,
    isDeleteConfirmModalOpen,
    setIsDeleteConfirmModalOpen,
    deleteTargetPageId,
    setDeleteTargetPageId,
    deleteMode,
    setDeleteMode,
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
