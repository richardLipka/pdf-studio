import React, { useState, useRef, useEffect } from 'react';
import SignaturePad from 'signature_pad';
import { useI18n } from '../../i18n/context';
import { useEditor } from '../../context/EditorContext';
import { useDocument } from '../../context/DocumentContext';
import { cleanSignatureBackground, readFileAsDataUrl } from '../../utils/file';
import { SignatureAnnotation } from '../../types/annotations';
import {
  PenLine,
  Type,
  Upload,
  Bookmark,
  X,
  RotateCcw,
  Check,
  Trash2,
  Loader2,
  Download,
  UploadCloud,
  Layers,
} from 'lucide-react';

export const SignatureModal: React.FC = () => {
  const { t } = useI18n();
  const {
    isSignatureModalOpen,
    setIsSignatureModalOpen,
    stamps,
    addStamp,
    removeStamp,
    exportStampsToJson,
    importStampsFromJson,
  } = useEditor();

  const { pages, activePageIndex, addAnnotation } = useDocument();

  const [activeTab, setActiveTab] = useState<'draw' | 'type' | 'upload' | 'saved'>('draw');
  const [stampTitle, setStampTitle] = useState<string>('');

  // Draw State
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sigPadRef = useRef<SignaturePad | null>(null);

  // Type State
  const [typedText, setTypedText] = useState<string>('');
  const [selectedFont, setSelectedFont] = useState<string>('Dancing Script');

  // Upload State
  const [uploadedDataUrl, setUploadedDataUrl] = useState<string | null>(null);
  const [cleanBg, setCleanBg] = useState<boolean>(true);
  const [isProcessingBg, setIsProcessingBg] = useState<boolean>(false);
  const [isDragOver, setIsDragOver] = useState<boolean>(false);
  const [importMessage, setImportMessage] = useState<{ text: string; isError?: boolean } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const jsonImportInputRef = useRef<HTMLInputElement>(null);

  // Initialize SignaturePad when draw tab is open
  useEffect(() => {
    if (isSignatureModalOpen && activeTab === 'draw' && canvasRef.current) {
      const canvas = canvasRef.current;
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      canvas.width = canvas.offsetWidth * ratio;
      canvas.height = canvas.offsetHeight * ratio;
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.scale(ratio, ratio);

      sigPadRef.current = new SignaturePad(canvas, {
        minWidth: 1.5,
        maxWidth: 3.5,
        penColor: '#0f172a',
        backgroundColor: 'rgba(255, 255, 255, 0)',
      });
    }

    return () => {
      sigPadRef.current?.off();
    };
  }, [isSignatureModalOpen, activeTab]);

  if (!isSignatureModalOpen) return null;

  const handleClearDraw = () => {
    sigPadRef.current?.clear();
  };

  const handleProcessImage = async (file: File) => {
    const dataUrl = await readFileAsDataUrl(file);
    if (!stampTitle) {
      setStampTitle(file.name.replace(/\.[^/.]+$/, ''));
    }
    if (cleanBg) {
      setIsProcessingBg(true);
      const cleaned = await cleanSignatureBackground(dataUrl);
      setUploadedDataUrl(cleaned);
      setIsProcessingBg(false);
    } else {
      setUploadedDataUrl(dataUrl);
    }
  };

  const handleUploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await handleProcessImage(file);
    }
  };

  const handleToggleCleanBg = async (checked: boolean) => {
    setCleanBg(checked);
    if (uploadedDataUrl) {
      setIsProcessingBg(true);
      if (checked) {
        const cleaned = await cleanSignatureBackground(uploadedDataUrl);
        setUploadedDataUrl(cleaned);
      }
      setIsProcessingBg(false);
    }
  };

  const generateTypedSignatureImage = (): string => {
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 200;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = `60px "${selectedFont}", cursive`;
    ctx.fillStyle = '#0f172a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(typedText || 'Signature', canvas.width / 2, canvas.height / 2);

    return canvas.toDataURL('image/png');
  };

  const insertSignatureOntoDocument = (dataUrl: string, shouldSavePreset: boolean, titleText?: string) => {
    if (shouldSavePreset) {
      addStamp({
        title: titleText || stampTitle || `Razítko / Stamp ${stamps.length + 1}`,
        imageDataUrl: dataUrl,
      });
    }

    const currentPage = pages[activePageIndex] || pages[0];
    if (!currentPage) return;

    // Place signature in the lower center of the page
    const sigWidth = 160;
    const sigHeight = 70;
    const sigX = (currentPage.width - sigWidth) / 2;
    const sigY = currentPage.height - 180;

    const newSigAnn: SignatureAnnotation = {
      id: `sig_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      pageId: currentPage.id,
      type: 'signature',
      x: Math.max(20, sigX),
      y: Math.max(20, sigY),
      width: sigWidth,
      height: sigHeight,
      color: '#000000',
      opacity: 1.0,
      imageDataUrl: dataUrl,
      signatureType: activeTab === 'saved' ? 'draw' : activeTab,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    addAnnotation(newSigAnn);
    setIsSignatureModalOpen(false);
  };

  const handleConfirmInsert = (shouldSave: boolean) => {
    let finalDataUrl = '';
    let autoTitle = stampTitle;

    if (activeTab === 'draw') {
      if (sigPadRef.current?.isEmpty()) return;
      finalDataUrl = sigPadRef.current?.toDataURL('image/png') || '';
      if (!autoTitle) autoTitle = 'Ruční podpis / Hand signature';
    } else if (activeTab === 'type') {
      if (!typedText.trim()) return;
      finalDataUrl = generateTypedSignatureImage();
      if (!autoTitle) autoTitle = typedText;
    } else if (activeTab === 'upload') {
      if (!uploadedDataUrl) return;
      finalDataUrl = uploadedDataUrl;
      if (!autoTitle) autoTitle = 'Razítko / Stamp';
    }

    if (finalDataUrl) {
      insertSignatureOntoDocument(finalDataUrl, shouldSave, autoTitle);
    }
  };

  const handleJsonImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const res = await importStampsFromJson(file);
    if (res.success) {
      setImportMessage({
        text: `${t.signatureModal.importSuccess} (${res.count})`,
      });
    } else {
      setImportMessage({
        text: `${t.signatureModal.importError}: ${res.error || ''}`,
        isError: true,
      });
    }
    setTimeout(() => setImportMessage(null), 4000);
    if (jsonImportInputRef.current) jsonImportInputRef.current.value = '';
  };

  const fonts = [
    { name: 'Dancing Script', label: 'Dancing Script' },
    { name: 'Caveat', label: 'Caveat' },
    { name: 'Sacramento', label: 'Sacramento' },
    { name: 'Great Vibes', label: 'Great Vibes' },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <PenLine className="w-5 h-5 text-emerald-400" />
              {t.signatureModal.title}
            </h2>
            <p className="text-xs text-slate-400">{t.signatureModal.subtitle}</p>
          </div>
          <button
            onClick={() => setIsSignatureModalOpen(false)}
            className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-800 px-6 pt-2 bg-slate-900/50">
          <button
            onClick={() => setActiveTab('draw')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-all ${
              activeTab === 'draw'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <PenLine className="w-3.5 h-3.5" />
            {t.signatureModal.tabDraw}
          </button>

          <button
            onClick={() => setActiveTab('type')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-all ${
              activeTab === 'type'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Type className="w-3.5 h-3.5" />
            {t.signatureModal.tabType}
          </button>

          <button
            onClick={() => setActiveTab('upload')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-all ${
              activeTab === 'upload'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Upload className="w-3.5 h-3.5" />
            {t.signatureModal.tabUpload}
          </button>

          <button
            onClick={() => setActiveTab('saved')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-all ${
              activeTab === 'saved'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            {t.signatureModal.tabSaved} ({stamps.length})
          </button>
        </div>

        {/* Tab Body */}
        <div className="p-6">
          {/* Optional Stamp Title Field for Draw, Type & Upload */}
          {activeTab !== 'saved' && (
            <div className="mb-3">
              <input
                type="text"
                value={stampTitle}
                onChange={(e) => setStampTitle(e.target.value)}
                placeholder={t.signatureModal.stampTitlePlaceholder}
                className="w-full bg-slate-800/80 border border-slate-700 rounded-xl px-3.5 py-1.5 text-xs text-slate-200 placeholder-slate-500 outline-none focus:border-emerald-500"
              />
            </div>
          )}

          {/* TAB 1: DRAW */}
          {activeTab === 'draw' && (
            <div>
              <div className="relative bg-white rounded-xl border border-slate-300 shadow-inner h-52 flex flex-col justify-between overflow-hidden">
                <canvas ref={canvasRef} className="w-full h-full cursor-crosshair block" />
                <div className="absolute bottom-2 right-2 flex items-center gap-2">
                  <button
                    onClick={handleClearDraw}
                    className="px-2.5 py-1 text-xs rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium flex items-center gap-1 border border-slate-300 shadow-sm"
                  >
                    <RotateCcw className="w-3 h-3" />
                    {t.signatureModal.clear}
                  </button>
                </div>
              </div>
              <p className="text-[11px] text-slate-400 text-center mt-2">
                {t.signatureModal.drawInstruction}
              </p>
            </div>
          )}

          {/* TAB 2: TYPE */}
          {activeTab === 'type' && (
            <div className="space-y-4">
              <input
                type="text"
                value={typedText}
                onChange={(e) => {
                  setTypedText(e.target.value);
                  if (!stampTitle) setStampTitle(e.target.value);
                }}
                placeholder={t.signatureModal.typePlaceholder}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-slate-100 placeholder-slate-500 text-sm outline-none focus:border-emerald-500"
                autoFocus
              />

              <div>
                <span className="text-xs text-slate-400 font-medium mb-2 block">
                  {t.signatureModal.selectFont}
                </span>
                <div className="grid grid-cols-2 gap-2.5">
                  {fonts.map((f) => (
                    <button
                      key={f.name}
                      onClick={() => setSelectedFont(f.name)}
                      className={`p-3 rounded-xl border text-center transition-all ${
                        selectedFont === f.name
                          ? 'bg-emerald-950/40 border-emerald-500 text-emerald-300 ring-1 ring-emerald-500'
                          : 'bg-slate-800/60 border-slate-700 text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      <span
                        style={{ fontFamily: `"${f.name}", cursive` }}
                        className="text-2xl block truncate"
                      >
                        {typedText || 'Signature'}
                      </span>
                      <span className="text-[10px] text-slate-400 block mt-1">
                        {f.label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: UPLOAD WITH DRAG AND DROP */}
          {activeTab === 'upload' && (
            <div className="space-y-4">
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleUploadFile}
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
              />

              {!uploadedDataUrl ? (
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragOver(true);
                  }}
                  onDragLeave={() => setIsDragOver(false)}
                  onDrop={async (e) => {
                    e.preventDefault();
                    setIsDragOver(false);
                    const file = e.dataTransfer.files?.[0];
                    if (file && file.type.startsWith('image/')) {
                      await handleProcessImage(file);
                    }
                  }}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-2xl p-8 flex flex-col items-center justify-center cursor-pointer transition-all ${
                    isDragOver
                      ? 'border-emerald-400 bg-emerald-950/40 scale-[1.01]'
                      : 'border-slate-700 hover:border-emerald-500 bg-slate-800/40 hover:bg-slate-800/80'
                  }`}
                >
                  <Upload className="w-10 h-10 text-emerald-400 mb-2" />
                  <span className="text-sm font-medium text-slate-200">
                    {t.signatureModal.uploadTitle}
                  </span>
                  <span className="text-xs text-slate-400 mt-1">
                    {t.signatureModal.uploadDesc}
                  </span>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="bg-slate-800/80 rounded-xl p-4 flex items-center justify-center border border-slate-700 h-40 relative">
                    {isProcessingBg ? (
                      <div className="flex flex-col items-center gap-2 text-emerald-400">
                        <Loader2 className="w-6 h-6 animate-spin" />
                        <span className="text-xs">{t.signatureModal.removeBackground}</span>
                      </div>
                    ) : (
                      <img
                        src={uploadedDataUrl}
                        alt="Uploaded Signature"
                        className="max-h-full max-w-full object-contain"
                      />
                    )}
                  </div>

                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300">
                      <input
                        type="checkbox"
                        checked={cleanBg}
                        onChange={(e) => handleToggleCleanBg(e.target.checked)}
                        className="rounded border-slate-600 text-emerald-500 focus:ring-emerald-500 bg-slate-800"
                      />
                      <span>{t.signatureModal.removeBackground}</span>
                    </label>

                    <button
                      onClick={() => {
                        setUploadedDataUrl(null);
                        if (fileInputRef.current) fileInputRef.current.value = '';
                      }}
                      className="text-xs text-rose-400 hover:underline"
                    >
                      {t.signatureModal.clear}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 4: STAMP LIBRARY & JSON EXPORT/IMPORT */}
          {activeTab === 'saved' && (
            <div className="space-y-3">
              {/* Export / Import Toolbar */}
              <div className="flex items-center justify-between bg-slate-800/60 p-2.5 rounded-xl border border-slate-700">
                <input
                  type="file"
                  ref={jsonImportInputRef}
                  onChange={handleJsonImport}
                  accept=".json,application/json"
                  className="hidden"
                />

                <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  <Bookmark className="w-3.5 h-3.5 text-emerald-400" />
                  <span>{t.signatureModal.savedSignatures}</span>
                </span>

                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => jsonImportInputRef.current?.click()}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors"
                    title={t.signatureModal.importStampsJson}
                  >
                    <UploadCloud className="w-3 h-3 text-sky-400" />
                    <span>Import JSON</span>
                  </button>

                  <button
                    onClick={exportStampsToJson}
                    disabled={stamps.length === 0}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors disabled:opacity-40"
                    title={t.signatureModal.exportStampsJson}
                  >
                    <Download className="w-3 h-3 text-emerald-400" />
                    <span>Export JSON</span>
                  </button>
                </div>
              </div>

              {/* Status Message */}
              {importMessage && (
                <div
                  className={`text-xs px-3 py-1.5 rounded-lg border ${
                    importMessage.isError
                      ? 'bg-rose-950/80 border-rose-600 text-rose-300'
                      : 'bg-emerald-950/80 border-emerald-600 text-emerald-300'
                  }`}
                >
                  {importMessage.text}
                </div>
              )}

              {/* Stamps Grid */}
              {stamps.length === 0 ? (
                <div className="py-8 text-center text-slate-400 text-xs">
                  {t.signatureModal.noSavedSignatures}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 max-h-56 overflow-y-auto pr-1">
                  {stamps.map((stamp) => (
                    <div
                      key={stamp.id}
                      className="group relative bg-slate-800 hover:bg-slate-700/80 rounded-xl p-3 border border-slate-700 flex flex-col items-center justify-between cursor-pointer transition-all"
                      onClick={() => insertSignatureOntoDocument(stamp.imageDataUrl, false, stamp.title)}
                    >
                      <div className="h-16 w-full flex items-center justify-center">
                        <img
                          src={stamp.imageDataUrl}
                          alt={stamp.title}
                          className="max-h-full max-w-full object-contain"
                        />
                      </div>
                      
                      <span className="text-[11px] font-medium text-slate-300 mt-2 truncate max-w-full">
                        {stamp.title}
                      </span>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeStamp(stamp.id);
                        }}
                        className="absolute top-1.5 right-1.5 p-1 rounded-md bg-rose-950/80 text-rose-400 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-rose-900"
                        title={t.signatureModal.deleteSaved}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-900/80 flex items-center justify-end gap-2.5">
          <button
            onClick={() => setIsSignatureModalOpen(false)}
            className="px-4 py-2 text-xs font-semibold rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
          >
            {t.addPageModal.cancel}
          </button>

          {activeTab !== 'saved' && (
            <>
              <button
                onClick={() => handleConfirmInsert(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-xl bg-emerald-700 hover:bg-emerald-600 text-white shadow-md transition-all"
              >
                <Bookmark className="w-3.5 h-3.5" />
                <span>{t.signatureModal.saveAndInsert}</span>
              </button>

              <button
                onClick={() => handleConfirmInsert(false)}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white shadow-md shadow-emerald-500/20 active:scale-95 transition-all"
              >
                <Check className="w-3.5 h-3.5" />
                <span>{t.signatureModal.insert}</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
