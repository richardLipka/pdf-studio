import React, { useRef, useState } from 'react';
import { useI18n } from '../../i18n/context';
import { useDocument } from '../../context/DocumentContext';
import { useTheme } from '../../context/ThemeContext';
import { createSamplePdfDoc } from '../../utils/file';
import {
  FileUp,
  Sparkles,
  Files,
  PenTool,
  FileSignature,
  ShieldCheck,
  Loader2,
  Lock,
} from 'lucide-react';

export const Dropzone: React.FC = () => {
  const { language, t } = useI18n();
  const { theme } = useTheme();
  const { loadPdfFile, loadSamplePdf } = useDocument();

  const [isDragOver, setIsDragOver] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const isMinimal = theme === 'minimal';
  const isLcars = theme === 'lcars';

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
    <div
      className={`flex-1 flex flex-col items-center justify-center p-6 md:p-12 overflow-y-auto select-none ${
        isMinimal
          ? 'bg-white text-black'
          : isLcars
          ? 'bg-black text-amber-500'
          : 'bg-radial-gradient text-slate-100'
      }`}
    >
      <div className="w-full max-w-2xl flex flex-col items-center text-center space-y-6">
        {/* Hero Title & Badge */}
        <div className="space-y-3">
          <div
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${
              isMinimal
                ? 'bg-neutral-100 text-neutral-800 border border-neutral-300'
                : isLcars
                ? 'bg-black text-[#ff9900] border-2 border-[#ff9900] uppercase tracking-wider'
                : 'bg-sky-950/80 text-sky-400 border border-sky-800 shadow-inner'
            }`}
          >
            <ShieldCheck
              className={`w-4 h-4 ${
                isMinimal ? 'text-black' : isLcars ? 'text-[#ff9900]' : 'text-emerald-400'
              }`}
            />
            <span>{t.app.privacyBadge}</span>
          </div>

          <h1
            className={`text-3xl md:text-5xl font-extrabold tracking-tight ${
              isMinimal ? 'text-black font-semibold' : isLcars ? 'text-[#ff9900] uppercase' : 'text-white'
            }`}
          >
            {t.app.title}
          </h1>

          <p
            className={`text-sm md:text-base max-w-lg mx-auto ${
              isMinimal ? 'text-neutral-600' : isLcars ? 'text-[#ff9966]' : 'text-slate-400'
            }`}
          >
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
          className={`w-full p-8 md:p-12 transition-all cursor-pointer flex flex-col items-center justify-center space-y-4 ${
            isMinimal
              ? isDragOver
                ? 'border-2 border-black bg-neutral-50 rounded-xl'
                : 'border-2 border-dashed border-neutral-300 hover:border-black bg-white rounded-xl'
              : isLcars
              ? isDragOver
                ? 'border-2 border-[#ffcc00] bg-[#111111] rounded-3xl shadow-[0_0_20px_rgba(255,153,0,0.4)]'
                : 'border-2 border-dashed border-[#ff9900] hover:border-[#ffcc00] bg-black rounded-3xl'
              : isDragOver
              ? 'border-2 border-dashed border-sky-400 bg-sky-950/40 rounded-3xl scale-[1.01] shadow-2xl shadow-sky-900/30'
              : 'border-2 border-dashed border-slate-700 hover:border-sky-500 bg-slate-900/60 hover:bg-slate-900/90 rounded-3xl shadow-xl'
          }`}
        >
          <div
            className={`w-16 h-16 flex items-center justify-center transition-transform ${
              isMinimal
                ? 'rounded-lg bg-neutral-100 border border-neutral-300 text-black'
                : isLcars
                ? 'rounded-full bg-[#1a1a1a] border-2 border-[#ff9900] text-[#ff9900]'
                : 'rounded-2xl bg-sky-600/20 border border-sky-500/30 text-sky-400 shadow-inner group-hover:scale-110'
            }`}
          >
            {isLoading ? (
              <Loader2 className="w-8 h-8 animate-spin" />
            ) : (
              <FileUp className="w-8 h-8" />
            )}
          </div>

          <div className="space-y-1">
            <p
              className={`text-base font-bold ${
                isMinimal ? 'text-black' : isLcars ? 'text-[#ff9900] uppercase' : 'text-slate-100'
              }`}
            >
              {t.dropzone.dropHere}
            </p>
            <p
              className={`text-xs ${
                isMinimal ? 'text-neutral-500' : isLcars ? 'text-[#cc99cc]' : 'text-slate-400'
              }`}
            >
              {t.dropzone.supports}
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                fileInputRef.current?.click();
              }}
              className={`px-5 py-2.5 text-xs font-bold transition-all ${
                isMinimal
                  ? 'rounded-md bg-black hover:bg-neutral-800 text-white border border-black'
                  : isLcars
                  ? 'rounded-full bg-[#ff9900] hover:bg-[#ffcc00] text-black uppercase tracking-wider'
                  : 'rounded-xl bg-sky-600 hover:bg-sky-500 text-white shadow-lg shadow-sky-600/20 active:scale-95'
              }`}
            >
              {t.dropzone.browseFiles}
            </button>

            <button
              onClick={(e) => {
                e.stopPropagation();
                handleLoadSample();
              }}
              className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold transition-all ${
                isMinimal
                  ? 'rounded-md bg-white hover:bg-neutral-100 text-black border border-neutral-300'
                  : isLcars
                  ? 'rounded-full bg-[#111111] hover:bg-[#222222] text-[#ff9966] border border-[#ff9966] uppercase'
                  : 'rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 shadow-sm'
              }`}
            >
              <Sparkles
                className={`w-4 h-4 ${
                  isMinimal ? 'text-black' : isLcars ? 'text-[#ff9966]' : 'text-amber-400'
                }`}
              />
              <span>{t.dropzone.loadSample}</span>
            </button>
          </div>
        </div>

        {/* 4 Key Feature Badges */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 w-full pt-4">
          <div
            className={`p-3 text-left ${
              isMinimal
                ? 'rounded-lg bg-white border border-neutral-200'
                : isLcars
                ? 'rounded-xl bg-[#0a0a0a] border border-[#333333]'
                : 'rounded-xl bg-slate-900/40 border border-slate-800'
            }`}
          >
            <Files
              className={`w-4 h-4 mb-1.5 ${
                isMinimal ? 'text-black' : isLcars ? 'text-[#99ccff]' : 'text-indigo-400'
              }`}
            />
            <div
              className={`text-xs font-bold ${
                isMinimal ? 'text-black' : isLcars ? 'text-[#ff9900]' : 'text-slate-200'
              }`}
            >
              {language === 'cs' ? 'Správa stránek' : 'Page Management'}
            </div>
            <div
              className={`text-[10px] mt-0.5 ${
                isMinimal ? 'text-neutral-500' : isLcars ? 'text-[#cc99cc]' : 'text-slate-400'
              }`}
            >
              {language === 'cs' ? 'Přidání, mazání, řazení, rotace' : 'Add, delete, reorder, rotate'}
            </div>
          </div>

          <div
            className={`p-3 text-left ${
              isMinimal
                ? 'rounded-lg bg-white border border-neutral-200'
                : isLcars
                ? 'rounded-xl bg-[#0a0a0a] border border-[#333333]'
                : 'rounded-xl bg-slate-900/40 border border-slate-800'
            }`}
          >
            <PenTool
              className={`w-4 h-4 mb-1.5 ${
                isMinimal ? 'text-black' : isLcars ? 'text-[#ff9966]' : 'text-sky-400'
              }`}
            />
            <div
              className={`text-xs font-bold ${
                isMinimal ? 'text-black' : isLcars ? 'text-[#ff9900]' : 'text-slate-200'
              }`}
            >
              {language === 'cs' ? 'Revize a značky' : 'Review Markups'}
            </div>
            <div
              className={`text-[10px] mt-0.5 ${
                isMinimal ? 'text-neutral-500' : isLcars ? 'text-[#cc99cc]' : 'text-slate-400'
              }`}
            >
              {language === 'cs' ? 'Zvýraznění, škrtání, poznámky' : 'Highlight, strike, sticky notes'}
            </div>
          </div>

          <div
            className={`p-3 text-left ${
              isMinimal
                ? 'rounded-lg bg-white border border-neutral-200'
                : isLcars
                ? 'rounded-xl bg-[#0a0a0a] border border-[#333333]'
                : 'rounded-xl bg-slate-900/40 border border-slate-800'
            }`}
          >
            <FileSignature
              className={`w-4 h-4 mb-1.5 ${
                isMinimal ? 'text-black' : isLcars ? 'text-[#ffff66]' : 'text-emerald-400'
              }`}
            />
            <div
              className={`text-xs font-bold ${
                isMinimal ? 'text-black' : isLcars ? 'text-[#ff9900]' : 'text-slate-200'
              }`}
            >
              {language === 'cs' ? 'Podpisy a razítka' : 'Signatures'}
            </div>
            <div
              className={`text-[10px] mt-0.5 ${
                isMinimal ? 'text-neutral-500' : isLcars ? 'text-[#cc99cc]' : 'text-slate-400'
              }`}
            >
              {language === 'cs' ? 'Kreslení, psaní, průhledný scan' : 'Draw, type, transparent scan'}
            </div>
          </div>

          <div
            className={`p-3 text-left ${
              isMinimal
                ? 'rounded-lg bg-white border border-neutral-200'
                : isLcars
                ? 'rounded-xl bg-[#0a0a0a] border border-[#333333]'
                : 'rounded-xl bg-slate-900/40 border border-slate-800'
            }`}
          >
            <Lock
              className={`w-4 h-4 mb-1.5 ${
                isMinimal ? 'text-black' : isLcars ? 'text-[#cc99cc]' : 'text-rose-400'
              }`}
            />
            <div
              className={`text-xs font-bold ${
                isMinimal ? 'text-black' : isLcars ? 'text-[#ff9900]' : 'text-slate-200'
              }`}
            >
              {language === 'cs' ? '100% Soukromí' : '100% Client-Side'}
            </div>
            <div
              className={`text-[10px] mt-0.5 ${
                isMinimal ? 'text-neutral-500' : isLcars ? 'text-[#cc99cc]' : 'text-slate-400'
              }`}
            >
              {language === 'cs' ? 'Žádné nahrávání na server' : 'Zero server uploads'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
