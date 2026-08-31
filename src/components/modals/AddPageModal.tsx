import React, { useState, useRef } from 'react';
import { useI18n } from '../../i18n/context';
import { useEditor } from '../../context/EditorContext';
import { useDocument } from '../../context/DocumentContext';
import {
  createBlankPage,
  createImagePage,
  InsertPosition,
} from '../../services/pageManager';
import { parsePdfPages } from '../../services/pdfLoader';
import {
  getImageDimensions,
  readFileAsArrayBuffer,
  readFileAsDataUrl,
} from '../../utils/file';
import { SourceDocument } from '../../types/document';
import {
  FilePlus2,
  FileText,
  Image as ImageIcon,
  File,
  X,
  Upload,
  Check,
  Loader2,
  Layers,
} from 'lucide-react';

export const AddPageModal: React.FC = () => {
  const { t } = useI18n();
  const { isAddPageModalOpen, setIsAddPageModalOpen } = useEditor();
  const { insertPages, activePageIndex, pages } = useDocument();

  const [activeTab, setActiveTab] = useState<'pdf' | 'image' | 'blank'>('pdf');
  const [position, setPosition] = useState<InsertPosition>('after_current');
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [detectedPageCount, setDetectedPageCount] = useState<number | null>(null);
  const [isCountingPages, setIsCountingPages] = useState<boolean>(false);
  const [isDragOver, setIsDragOver] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isAddPageModalOpen) return null;

  const processFile = async (file: File) => {
    setSelectedFile(file);
    setDetectedPageCount(null);

    if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
      setIsCountingPages(true);
      try {
        const buffer = await file.arrayBuffer();
        const parsed = await parsePdfPages(buffer, 'inspect');
        setDetectedPageCount(parsed.length);
      } catch (err) {
        console.warn('Could not inspect PDF page count:', err);
      } finally {
        setIsCountingPages(false);
      }
    } else if (file.type.startsWith('image/')) {
      setDetectedPageCount(1);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const file = e.dataTransfer.files?.[0];
    if (file) {
      if (activeTab === 'pdf' && (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'))) {
        processFile(file);
      } else if (activeTab === 'image' && file.type.startsWith('image/')) {
        processFile(file);
      } else if (file.type === 'application/pdf') {
        setActiveTab('pdf');
        processFile(file);
      } else if (file.type.startsWith('image/')) {
        setActiveTab('image');
        processFile(file);
      }
    }
  };

  const handleConfirmInsert = async () => {
    setIsLoading(true);
    try {
      if (activeTab === 'blank') {
        const blankPage = createBlankPage(orientation);
        insertPages([blankPage], position);
      } else if (activeTab === 'image' && selectedFile) {
        const dataUrl = await readFileAsDataUrl(selectedFile);
        const { width, height } = await getImageDimensions(dataUrl);
        const imagePage = createImagePage(dataUrl, width, height);
        insertPages([imagePage], position);
      } else if (activeTab === 'pdf' && selectedFile) {
        const arrayBuffer = await readFileAsArrayBuffer(selectedFile);
        const sourceDocId = `merged_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        const newSource: SourceDocument = {
          id: sourceDocId,
          name: selectedFile.name,
          arrayBuffer,
        };
        const newPages = await parsePdfPages(arrayBuffer, sourceDocId);
        insertPages(newPages, position, newSource);
      }

      setIsAddPageModalOpen(false);
      setSelectedFile(null);
      setDetectedPageCount(null);
    } catch (e) {
      console.error('Failed to insert page(s):', e);
    } finally {
      setIsLoading(false);
    }
  };

  const currentPageNum = activePageIndex + 1;
  const totalPages = pages.length;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <FilePlus2 className="w-5 h-5 text-indigo-400" />
              {t.addPageModal.title}
            </h2>
            <p className="text-xs text-slate-400">{t.addPageModal.subtitle}</p>
          </div>
          <button
            onClick={() => setIsAddPageModalOpen(false)}
            className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Selection */}
        <div className="flex border-b border-slate-800 px-6 pt-2 bg-slate-900/50">
          <button
            onClick={() => {
              setActiveTab('pdf');
              setSelectedFile(null);
              setDetectedPageCount(null);
            }}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-all ${
              activeTab === 'pdf'
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            {t.addPageModal.tabPdf}
          </button>

          <button
            onClick={() => {
              setActiveTab('image');
              setSelectedFile(null);
              setDetectedPageCount(null);
            }}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-all ${
              activeTab === 'image'
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <ImageIcon className="w-3.5 h-3.5" />
            {t.addPageModal.tabImage}
          </button>

          <button
            onClick={() => {
              setActiveTab('blank');
              setSelectedFile(null);
              setDetectedPageCount(null);
            }}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-all ${
              activeTab === 'blank'
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <File className="w-3.5 h-3.5" />
            {t.addPageModal.tabBlank}
          </button>
        </div>

        {/* Tab Content */}
        <div className="p-6 space-y-5">
          {/* File Upload for PDF or Image */}
          {(activeTab === 'pdf' || activeTab === 'image') && (
            <div>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileSelect}
                accept={activeTab === 'pdf' ? 'application/pdf' : 'image/png,image/jpeg,image/webp'}
                className="hidden"
              />

              {!selectedFile ? (
                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-2xl p-7 flex flex-col items-center justify-center cursor-pointer transition-all ${
                    isDragOver
                      ? 'border-indigo-400 bg-indigo-950/50 scale-[1.01]'
                      : 'border-slate-700 hover:border-indigo-500 bg-slate-800/40 hover:bg-slate-800/80'
                  }`}
                >
                  <Upload className={`w-8 h-8 mb-2 ${isDragOver ? 'text-indigo-300' : 'text-indigo-400'}`} />
                  <span className="text-xs font-medium text-slate-200 text-center px-4">
                    {activeTab === 'pdf'
                      ? t.addPageModal.uploadPdfDesc
                      : t.addPageModal.uploadImageDesc}
                  </span>
                  <span className="text-[11px] text-indigo-400 mt-1 font-semibold">
                    {t.addPageModal.dragDropHere}
                  </span>
                </div>
              ) : (
                <div className="flex items-center justify-between p-3 rounded-xl bg-slate-800 border border-slate-700">
                  <div className="flex items-center gap-2.5 min-w-0 pr-2">
                    {activeTab === 'pdf' ? (
                      <FileText className="w-5 h-5 text-indigo-400 flex-shrink-0" />
                    ) : (
                      <ImageIcon className="w-5 h-5 text-indigo-400 flex-shrink-0" />
                    )}
                    <span className="text-xs font-medium text-slate-200 truncate">
                      {selectedFile.name}
                    </span>

                    {/* Detected Page Count Badge */}
                    {isCountingPages ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-indigo-300 bg-indigo-950/80 border border-indigo-700/60 px-2 py-0.5 rounded-full flex-shrink-0">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        <span>{t.addPageModal.loadingPages}</span>
                      </span>
                    ) : detectedPageCount !== null ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-300 bg-indigo-950/90 border border-indigo-500/70 px-2.5 py-0.5 rounded-full shadow-sm flex-shrink-0">
                        <Layers className="w-3 h-3 text-indigo-400" />
                        <span>
                          {detectedPageCount === 1
                            ? t.addPageModal.pageCountSingle
                            : t.addPageModal.pageCountBadge.replace('{count}', String(detectedPageCount))}
                        </span>
                      </span>
                    ) : null}
                  </div>

                  <button
                    onClick={() => {
                      setSelectedFile(null);
                      setDetectedPageCount(null);
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }}
                    className="p-1 text-slate-400 hover:text-rose-400 flex-shrink-0"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Blank Page Orientation */}
          {activeTab === 'blank' && (
            <div>
              <span className="text-xs text-slate-400 font-medium mb-2 block">
                {t.addPageModal.orientation}:
              </span>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setOrientation('portrait')}
                  className={`p-3 rounded-xl border text-center transition-all ${
                    orientation === 'portrait'
                      ? 'bg-indigo-950/40 border-indigo-500 text-indigo-300 ring-1 ring-indigo-500'
                      : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:bg-slate-800'
                  }`}
                >
                  <span className="text-xs font-semibold block">{t.addPageModal.portrait}</span>
                  <span className="text-[10px] text-slate-500 block mt-0.5">595 x 842 pt</span>
                </button>

                <button
                  onClick={() => setOrientation('landscape')}
                  className={`p-3 rounded-xl border text-center transition-all ${
                    orientation === 'landscape'
                      ? 'bg-indigo-950/40 border-indigo-500 text-indigo-300 ring-1 ring-indigo-500'
                      : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:bg-slate-800'
                  }`}
                >
                  <span className="text-xs font-semibold block">{t.addPageModal.landscape}</span>
                  <span className="text-[10px] text-slate-500 block mt-0.5">842 x 595 pt</span>
                </button>
              </div>
            </div>
          )}

          {/* Target Insertion Position */}
          <div>
            <span className="text-xs text-slate-400 font-medium mb-2 block">
              {t.addPageModal.insertPosition}
            </span>
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => setPosition('beginning')}
                className={`py-2 px-2 rounded-xl border text-xs font-medium text-center transition-all ${
                  position === 'beginning'
                    ? 'bg-indigo-950/50 border-indigo-500 text-indigo-200 ring-1 ring-indigo-500 shadow-md shadow-indigo-950/30'
                    : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:bg-slate-800'
                }`}
              >
                <span className="block font-semibold">{t.addPageModal.atBeginning}</span>
                <span className="text-[10px] text-slate-500 block mt-0.5">(1)</span>
              </button>

              <button
                onClick={() => setPosition('after_current')}
                className={`py-2 px-2 rounded-xl border text-xs font-medium text-center transition-all ${
                  position === 'after_current'
                    ? 'bg-indigo-950/50 border-indigo-500 text-indigo-200 ring-1 ring-indigo-500 shadow-md shadow-indigo-950/30'
                    : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:bg-slate-800'
                }`}
              >
                <span className="block font-semibold">
                  {t.addPageModal.afterCurrentWithPage.replace('{page}', String(currentPageNum))}
                </span>
                <span className="text-[10px] text-indigo-400/80 block mt-0.5">
                  ({currentPageNum} / {totalPages})
                </span>
              </button>

              <button
                onClick={() => setPosition('end')}
                className={`py-2 px-2 rounded-xl border text-xs font-medium text-center transition-all ${
                  position === 'end'
                    ? 'bg-indigo-950/50 border-indigo-500 text-indigo-200 ring-1 ring-indigo-500 shadow-md shadow-indigo-950/30'
                    : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:bg-slate-800'
                }`}
              >
                <span className="block font-semibold">{t.addPageModal.atEnd}</span>
                <span className="text-[10px] text-slate-500 block mt-0.5">({totalPages})</span>
              </button>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-900/80 flex items-center justify-end gap-2.5">
          <button
            onClick={() => setIsAddPageModalOpen(false)}
            className="px-4 py-2 text-xs font-semibold rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
          >
            {t.addPageModal.cancel}
          </button>

          <button
            onClick={handleConfirmInsert}
            disabled={isLoading || (activeTab !== 'blank' && !selectedFile)}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 text-white shadow-md shadow-indigo-500/20 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Check className="w-4 h-4" />
            )}
            <span>{t.addPageModal.insertButton}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
