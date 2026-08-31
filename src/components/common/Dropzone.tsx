import React, { useRef, useState } from 'react';
import { useI18n } from '../../i18n/context';
import { useDocument } from '../../context/DocumentContext';
import { createSamplePdfDoc } from '../../utils/file';
import {
  FileUp,
  Sparkles,
  Files,
  PenTool,
  FileSignature,
  ShieldCheck,
  Loader2,
} from 'lucide-react';

export const Dropzone: React.FC = () => {
  const { language, t } = useI18n();
  const { loadPdfFile, loadSamplePdf } = useDocument();

  const [isDragOver, setIsDragOver] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type === 'application/pdf') {
      setIsLoading(true);
      try {
        await loadPdfFile(file);
      } finally {
        setIsLoading(false);
      }
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setIsLoading(true);
      try {
        await loadPdfFile(file);
      } finally {
        setIsLoading(false);
      }
    }
  };

  const handleLoadSample = async () => {
    setIsLoading(true);
    try {
      const sampleBuffer = await createSamplePdfDoc(language);
      await loadSamplePdf(sampleBuffer, language);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 md:p-12 overflow-y-auto select-none bg-radial-gradient">
      <div className="w-full max-w-2xl flex flex-col items-center text-center space-y-6">
        {/* Hero Title & Badge */}
        <div className="space-y-3">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-sky-950/80 text-sky-400 border border-sky-800 text-xs font-semibold shadow-inner">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>{t.app.privacyBadge}</span>
          </div>

          <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight text-white">
            {t.app.title}
          </h1>

          <p className="text-sm md:text-base text-slate-400 max-w-lg mx-auto">
            {t.app.subtitle}
          </p>
        </div>

        {/* Drag and Drop Zone */}
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileSelect}
          accept="application/pdf"
          className="hidden"
        />

        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`w-full p-8 md:p-12 rounded-3xl border-2 border-dashed transition-all cursor-pointer flex flex-col items-center justify-center space-y-4 ${
            isDragOver
              ? 'border-sky-400 bg-sky-950/40 scale-[1.01] shadow-2xl shadow-sky-900/30'
              : 'border-slate-700 hover:border-sky-500 bg-slate-900/60 hover:bg-slate-900/90 shadow-xl'
          }`}
        >
          <div className="w-16 h-16 rounded-2xl bg-sky-600/20 border border-sky-500/30 flex items-center justify-center text-sky-400 shadow-inner group-hover:scale-110 transition-transform">
            {isLoading ? (
              <Loader2 className="w-8 h-8 animate-spin" />
            ) : (
              <FileUp className="w-8 h-8" />
            )}
          </div>

          <div className="space-y-1">
            <p className="text-base font-bold text-slate-100">
              {t.dropzone.dropHere}
            </p>
            <p className="text-xs text-slate-400">{t.dropzone.supports}</p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                fileInputRef.current?.click();
              }}
              className="px-5 py-2.5 rounded-xl text-xs font-bold bg-sky-600 hover:bg-sky-500 text-white shadow-lg shadow-sky-600/20 active:scale-95 transition-all"
            >
              {t.dropzone.browseFiles}
            </button>

            <button
              onClick={(e) => {
                e.stopPropagation();
                handleLoadSample();
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 shadow-sm transition-all"
            >
              <Sparkles className="w-4 h-4 text-amber-400" />
              <span>{t.dropzone.loadSample}</span>
            </button>
          </div>
        </div>

        {/* 4 Key Feature Badges */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 w-full pt-4">
          <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-3 text-left">
            <Files className="w-4 h-4 text-indigo-400 mb-1.5" />
            <div className="text-xs font-bold text-slate-200">
              {language === 'cs' ? 'Správa stránek' : 'Page Management'}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              {language === 'cs' ? 'Přidání, mazání, řazení, rotace' : 'Add, delete, reorder, rotate'}
            </div>
          </div>

          <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-3 text-left">
            <PenTool className="w-4 h-4 text-sky-400 mb-1.5" />
            <div className="text-xs font-bold text-slate-200">
              {language === 'cs' ? 'Revize a značky' : 'Review Markups'}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              {language === 'cs' ? 'Zvýraznění, škrtání, poznámky' : 'Highlight, strike, sticky notes'}
            </div>
          </div>

          <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-3 text-left">
            <FileSignature className="w-4 h-4 text-emerald-400 mb-1.5" />
            <div className="text-xs font-bold text-slate-200">
              {language === 'cs' ? 'Podpisy a razítka' : 'Signatures'}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              {language === 'cs' ? 'Kreslení, psaní, průhledný scan' : 'Draw, type, transparent scan'}
            </div>
          </div>

          <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-3 text-left">
            <ShieldCheck className="w-4 h-4 text-teal-400 mb-1.5" />
            <div className="text-xs font-bold text-slate-200">
              {language === 'cs' ? '100% v prohlížeči' : '100% In-Browser'}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              {language === 'cs' ? 'Žádné nahrávání na servery' : 'Zero server uploads'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
