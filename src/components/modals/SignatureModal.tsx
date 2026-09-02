import React, { useState, useRef, useEffect } from 'react';
import SignaturePad from 'signature_pad';
import { useI18n } from '../../i18n/context';
import { useEditor } from '../../context/EditorContext';
import { useDocument } from '../../context/DocumentContext';
import { cleanSignatureBackground, readFileAsDataUrl } from '../../utils/file';
import { SignatureAnnotation } from '../../types/annotations';
import {
  parsePkcs12,
  generateSelfSignedCertificate,
  ParsedCertificateInfo,
} from '../../services/digitalSignatureService';
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
  ShieldCheck,
  KeyRound,
  FileCheck2,
  Sparkles,
  AlertCircle,
  Lock,
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

  const { pages, activePageIndex, addAnnotation, signAndDownload } = useDocument();

  const [activeTab, setActiveTab] = useState<'draw' | 'type' | 'upload' | 'saved' | 'certificate'>('draw');
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
  const certFileInputRef = useRef<HTMLInputElement>(null);

  // Certificate / PAdES State
  const [certFile, setCertFile] = useState<File | null>(null);
  const [certPassword, setCertPassword] = useState<string>('');
  const [isUnlockingCert, setIsUnlockingCert] = useState<boolean>(false);
  const [certError, setCertError] = useState<string | null>(null);
  const [loadedCertInfo, setLoadedCertInfo] = useState<ParsedCertificateInfo | null>(null);
  const [loadedPrivateKeyPem, setLoadedPrivateKeyPem] = useState<string | null>(null);
  const [loadedCertPem, setLoadedCertPem] = useState<string | null>(null);

  // Digital Signature Options
  const [sigReason, setSigReason] = useState<string>('Schváleno a odsouhlaseno');
  const [sigLocation, setSigLocation] = useState<string>('');
  const [sigVisualBadge, setSigVisualBadge] = useState<boolean>(true);
  const [isSigning, setIsSigning] = useState<boolean>(false);

  // Generator Drawer State
  const [showGenDrawer, setShowGenDrawer] = useState<boolean>(false);
  const [genName, setGenName] = useState<string>('');
  const [genOrg, setGenOrg] = useState<string>('Moje Společnost');
  const [genEmail, setGenEmail] = useState<string>('');
  const [genPassword, setGenPassword] = useState<string>('1234');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);

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

  useEffect(() => {
    if (!isSignatureModalOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setIsSignatureModalOpen(false);
      } else if (e.key === 'Enter') {
        if (activeTab === 'draw' || activeTab === 'type' || activeTab === 'upload') {
          e.preventDefault();
          handleConfirmInsert(false);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSignatureModalOpen, activeTab, typedText, uploadedDataUrl, stampTitle]);

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
      signatureType: activeTab === 'type' ? 'type' : activeTab === 'upload' ? 'upload' : 'draw',
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

  const handleCertFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setCertFile(file);
      setCertError(null);
    }
  };

  const handleUnlockCert = async () => {
    if (!certFile) return;
    setIsUnlockingCert(true);
    setCertError(null);
    try {
      const buffer = await certFile.arrayBuffer();
      const res = parsePkcs12(buffer, certPassword);
      setLoadedCertInfo(res.certInfo);
      setLoadedPrivateKeyPem(res.privateKeyPem);
      setLoadedCertPem(res.certificatePem);
      if (!sigReason) setSigReason('Schváleno a odsouhlaseno');
    } catch (err: any) {
      setCertError(err?.message || 'Chyba při odemykání certifikátu');
    } finally {
      setIsUnlockingCert(false);
    }
  };

  const handleGenerateSelfSigned = async () => {
    if (!genName.trim()) return;
    setIsGenerating(true);
    setCertError(null);
    try {
      const res = await generateSelfSignedCertificate({
        commonName: genName.trim(),
        organization: genOrg.trim(),
        email: genEmail.trim() || undefined,
        password: genPassword,
        validityDays: 365,
      });
      setLoadedCertInfo(res.certInfo);
      setLoadedPrivateKeyPem(res.privateKeyPem);
      setLoadedCertPem(res.certificatePem);
      setShowGenDrawer(false);
    } catch (err: any) {
      setCertError(err?.message || 'Chyba při generování certifikátu');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleClearLoadedCert = () => {
    setLoadedCertInfo(null);
    setLoadedPrivateKeyPem(null);
    setLoadedCertPem(null);
    setCertFile(null);
    setCertPassword('');
    setCertError(null);
    if (certFileInputRef.current) certFileInputRef.current.value = '';
  };

  const handleDigitalSignAndDownload = async () => {
    if (!loadedPrivateKeyPem || !loadedCertPem) return;
    setIsSigning(true);
    setCertError(null);
    try {
      const success = await signAndDownload(
        loadedPrivateKeyPem,
        loadedCertPem,
        {
          reason: sigReason,
          location: sigLocation,
          visualAppearance: sigVisualBadge,
          signerName: loadedCertInfo?.commonName,
        }
      );
      if (success) {
        setIsSignatureModalOpen(false);
      } else {
        setCertError(t.signatureModal.signError);
      }
    } catch (err: any) {
      setCertError(err?.message || t.signatureModal.signError);
    } finally {
      setIsSigning(false);
    }
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

          <button
            onClick={() => setActiveTab('certificate')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-all ${
              activeTab === 'certificate'
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            {t.signatureModal.tabCertificate}
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

          {/* TAB 5: DIGITAL CERTIFICATE (PAdES) */}
          {activeTab === 'certificate' && (
            <div className="space-y-4">
              <input
                type="file"
                ref={certFileInputRef}
                onChange={handleCertFileSelect}
                accept=".p12,.pfx,application/x-pkcs12"
                className="hidden"
              />

              {!loadedCertInfo ? (
                <div className="space-y-4">
                  {/* File Dropzone */}
                  <div
                    onClick={() => certFileInputRef.current?.click()}
                    className={`border-2 border-dashed rounded-2xl p-5 flex flex-col items-center justify-center cursor-pointer transition-all ${
                      certFile
                        ? 'border-indigo-500/80 bg-indigo-950/20'
                        : 'border-slate-700 hover:border-indigo-500/60 bg-slate-800/40 hover:bg-slate-800/80'
                    }`}
                  >
                    <div className="w-12 h-12 rounded-2xl bg-indigo-900/40 border border-indigo-700/50 flex items-center justify-center text-indigo-400 mb-2.5">
                      <ShieldCheck className="w-6 h-6" />
                    </div>
                    <p className="text-xs font-semibold text-slate-200 text-center">
                      {certFile ? certFile.name : t.signatureModal.certUploadTitle}
                    </p>
                    <p className="text-[11px] text-slate-400 text-center mt-1">
                      {t.signatureModal.certUploadDesc}
                    </p>
                  </div>

                  {/* Password Input & Unlock */}
                  {certFile && (
                    <div className="bg-slate-800/70 border border-slate-700/80 rounded-xl p-3.5 space-y-2.5 animate-in fade-in duration-150">
                      <label className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
                        <KeyRound className="w-3.5 h-3.5 text-indigo-400" />
                        <span>{t.signatureModal.certPasswordLabel}</span>
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="password"
                          value={certPassword}
                          onChange={(e) => setCertPassword(e.target.value)}
                          placeholder={t.signatureModal.certPasswordPlaceholder}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleUnlockCert();
                            }
                          }}
                          className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-white placeholder-slate-500 outline-none focus:border-indigo-500"
                        />
                        <button
                          type="button"
                          onClick={handleUnlockCert}
                          disabled={isUnlockingCert}
                          className="px-3.5 py-1.5 text-xs font-semibold rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white flex items-center gap-1.5 disabled:opacity-50 transition-all"
                        >
                          {isUnlockingCert ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Lock className="w-3.5 h-3.5" />
                          )}
                          <span>{t.signatureModal.certUnlockBtn}</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Self-Signed Generator Trigger */}
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={() => setShowGenDrawer(!showGenDrawer)}
                      className="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl border border-indigo-500/30 bg-indigo-950/20 hover:bg-indigo-950/40 text-indigo-300 text-xs font-medium transition-all"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                      <span>{t.signatureModal.certGenerateBtn}</span>
                    </button>
                  </div>

                  {/* Self-Signed Generator Drawer */}
                  {showGenDrawer && (
                    <div className="bg-slate-800/90 border border-indigo-500/40 rounded-2xl p-4 space-y-3 animate-in fade-in zoom-in-95 duration-150">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <FileCheck2 className="w-4 h-4 text-indigo-400" />
                          <h4 className="text-xs font-bold text-white">{t.signatureModal.certGenerateTitle}</h4>
                        </div>
                        <button
                          onClick={() => setShowGenDrawer(false)}
                          className="text-slate-400 hover:text-white text-xs p-1"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <p className="text-[11px] text-slate-400 leading-tight">
                        {t.signatureModal.certGenerateDesc}
                      </p>

                      <div className="space-y-2 text-xs">
                        <div>
                          <label className="text-[11px] text-slate-300 block mb-1">{t.signatureModal.certCommonName}</label>
                          <input
                            type="text"
                            value={genName}
                            onChange={(e) => setGenName(e.target.value)}
                            placeholder="Ing. Jan Novák"
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white outline-none focus:border-indigo-500 text-xs"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[11px] text-slate-300 block mb-1">{t.signatureModal.certOrganization}</label>
                            <input
                              type="text"
                              value={genOrg}
                              onChange={(e) => setGenOrg(e.target.value)}
                              placeholder="Firma s.r.o."
                              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white outline-none focus:border-indigo-500 text-xs"
                            />
                          </div>
                          <div>
                            <label className="text-[11px] text-slate-300 block mb-1">{t.signatureModal.certEmail}</label>
                            <input
                              type="email"
                              value={genEmail}
                              onChange={(e) => setGenEmail(e.target.value)}
                              placeholder="jan.novak@example.cz"
                              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white outline-none focus:border-indigo-500 text-xs"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="text-[11px] text-slate-300 block mb-1">Heslo klíčenky (.p12 / .pfx)</label>
                          <input
                            type="password"
                            value={genPassword}
                            onChange={(e) => setGenPassword(e.target.value)}
                            placeholder="1234"
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white outline-none focus:border-indigo-500 text-xs"
                          />
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={handleGenerateSelfSigned}
                        disabled={isGenerating || !genName.trim()}
                        className="w-full py-2 px-3 text-xs font-bold rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center gap-1.5 disabled:opacity-40 shadow-lg shadow-indigo-600/30 transition-all"
                      >
                        {isGenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                        <span>{t.signatureModal.certGenerateBtn}</span>
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                /* Loaded Certificate Card & Signature Options */
                <div className="space-y-4">
                  {/* Verified Certificate Card */}
                  <div className="bg-gradient-to-br from-indigo-950/60 to-slate-900 border border-indigo-500/50 rounded-2xl p-4 shadow-xl space-y-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="p-2 rounded-xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
                          <ShieldCheck className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="text-xs font-bold text-white">{loadedCertInfo.commonName}</h4>
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                              {loadedCertInfo.isExpired ? t.signatureModal.certExpired : t.signatureModal.certValid}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400">
                            {loadedCertInfo.organization || 'Osobní digitální certifikát'}
                          </p>
                        </div>
                      </div>

                      <button
                        onClick={handleClearLoadedCert}
                        className="text-[11px] font-medium text-slate-400 hover:text-rose-400 transition-colors p-1"
                        title={t.signatureModal.removeLoadedCert}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800 text-[11px] text-slate-300">
                      <div>
                        <span className="text-slate-500 block">{t.signatureModal.certIssuer}:</span>
                        <span className="truncate block font-mono text-[10px]">{loadedCertInfo.issuerName}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">{t.signatureModal.certValidUntil}:</span>
                        <span className="font-mono text-[10px]">{loadedCertInfo.validTo.toLocaleDateString()}</span>
                      </div>
                    </div>
                  </div>

                  {/* Signature Parameters */}
                  <div className="space-y-2.5 bg-slate-800/50 border border-slate-700/60 rounded-xl p-3.5">
                    <div>
                      <label className="text-[11px] font-medium text-slate-300 block mb-1">
                        {t.signatureModal.sigReason}
                      </label>
                      <input
                        type="text"
                        value={sigReason}
                        onChange={(e) => setSigReason(e.target.value)}
                        placeholder={t.signatureModal.sigReasonPlaceholder}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white outline-none focus:border-indigo-500"
                      />
                    </div>

                    <div>
                      <label className="text-[11px] font-medium text-slate-300 block mb-1">
                        {t.signatureModal.sigLocation}
                      </label>
                      <input
                        type="text"
                        value={sigLocation}
                        onChange={(e) => setSigLocation(e.target.value)}
                        placeholder={t.signatureModal.sigLocationPlaceholder}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white outline-none focus:border-indigo-500"
                      />
                    </div>

                    <label className="flex items-center gap-2 pt-1 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={sigVisualBadge}
                        onChange={(e) => setSigVisualBadge(e.target.checked)}
                        className="rounded border-slate-700 text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5"
                      />
                      <span className="text-xs text-slate-300">{t.signatureModal.sigVisualBadge}</span>
                    </label>
                  </div>
                </div>
              )}

              {/* Error Box */}
              {certError && (
                <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-950/80 border border-rose-600 text-rose-300 text-xs animate-in fade-in duration-100">
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                  <span>{certError}</span>
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

          {activeTab === 'certificate' ? (
            <button
              onClick={handleDigitalSignAndDownload}
              disabled={!loadedPrivateKeyPem || !loadedCertPem || isSigning}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/30 disabled:opacity-40 active:scale-95 transition-all"
            >
              {isSigning ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <ShieldCheck className="w-3.5 h-3.5" />
              )}
              <span>{t.signatureModal.signAndDownloadPdf}</span>
            </button>
          ) : activeTab !== 'saved' ? (
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
          ) : null}
        </div>
      </div>
    </div>
  );
};
