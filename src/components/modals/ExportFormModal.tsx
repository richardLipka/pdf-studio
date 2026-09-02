import React, { useState } from 'react';
import { useI18n } from '../../i18n/context';
import { useTheme } from '../../context/ThemeContext';
import { useEditor } from '../../context/EditorContext';
import { useDocument } from '../../context/DocumentContext';
import { FormExportMode } from '../../types/form';
import { FileEdit, Lock, Download, X, CheckCircle2 } from 'lucide-react';

export const ExportFormModal: React.FC = () => {
  const { t } = useI18n();
  const { theme } = useTheme();
  const { isExportFormModalOpen, setIsExportFormModalOpen, rasterSettings } = useEditor();
  const { saveAndDownload, formFields, formValues, metadata } = useDocument();

  const [selectedMode, setSelectedMode] = useState<FormExportMode>('interactive');
  const [isExporting, setIsExporting] = useState<boolean>(false);

  if (!isExportFormModalOpen) return null;

  const isMinimal = theme === 'minimal';
  const isLcars = theme === 'lcars';

  const filledFieldsCount = formFields.filter(
    (f) => formValues[f.name] !== undefined && String(formValues[f.name]).trim() !== ''
  ).length;

  const handleConfirm = async () => {
    setIsExporting(true);
    try {
      await saveAndDownload(undefined, rasterSettings, metadata, selectedMode);
      setIsExportFormModalOpen(false);
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-in fade-in duration-200">
      <div
        className={`w-full max-w-lg rounded-xl shadow-2xl border overflow-hidden flex flex-col transition-all ${
          isMinimal
            ? 'bg-white border-neutral-300 text-black'
            : isLcars
            ? 'bg-black border-[#ff9900] text-[#ff9900]'
            : 'bg-slate-900 border-slate-700 text-white'
        }`}
      >
        {/* Header */}
        <div
          className={`px-6 py-4 border-b flex items-center justify-between ${
            isMinimal
              ? 'border-neutral-200 bg-neutral-50'
              : isLcars
              ? 'border-[#ff9900] bg-[#111111]'
              : 'border-slate-800 bg-slate-950/60'
          }`}
        >
          <div className="flex items-center gap-3">
            <div
              className={`p-2 rounded-lg ${
                isMinimal
                  ? 'bg-blue-100 text-blue-700'
                  : isLcars
                  ? 'bg-[#ff9900]/20 text-[#ff9900]'
                  : 'bg-sky-500/20 text-sky-400'
              }`}
            >
              <FileEdit className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold tracking-tight">
                {t.exportFormModal?.title || 'Exportovat PDF formulář'}
              </h2>
              <p className="text-xs opacity-70">
                {t.exportFormModal?.subtitle ||
                  `Dokument obsahuje ${formFields.length} formulářových polí (${filledFieldsCount} vyplněno)`}
              </p>
            </div>
          </div>
          <button
            onClick={() => setIsExportFormModalOpen(false)}
            className="p-1.5 rounded-lg opacity-70 hover:opacity-100 transition-opacity"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Options */}
        <div className="p-6 space-y-4">
          <p className="text-xs opacity-80 leading-relaxed">
            {t.exportFormModal?.description ||
              'Zvolte, zda si přejete zachovat formulář interaktivní pro další vyplňování, nebo jej trvale zploštit:'}
          </p>

          {/* Option 1: Interactive AcroForm */}
          <div
            onClick={() => setSelectedMode('interactive')}
            className={`p-4 rounded-xl border-2 cursor-pointer transition-all flex items-start gap-3.5 ${
              selectedMode === 'interactive'
                ? isMinimal
                  ? 'border-blue-600 bg-blue-50/70 shadow-sm'
                  : isLcars
                  ? 'border-[#ff9900] bg-[#ff9900]/15'
                  : 'border-sky-500 bg-sky-500/10 shadow-lg shadow-sky-950/40'
                : isMinimal
                ? 'border-neutral-200 hover:border-neutral-300 bg-white'
                : isLcars
                ? 'border-[#333333] hover:border-[#ff9900]/60 bg-black'
                : 'border-slate-800 hover:border-slate-700 bg-slate-950/40'
            }`}
          >
            <div
              className={`p-2 rounded-lg mt-0.5 ${
                selectedMode === 'interactive'
                  ? isMinimal
                    ? 'bg-blue-600 text-white'
                    : isLcars
                    ? 'bg-[#ff9900] text-black'
                    : 'bg-sky-500 text-slate-950'
                  : 'bg-slate-800/80 text-slate-400'
              }`}
            >
              <FileEdit className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold">
                  {t.exportFormModal?.interactiveTitle || 'Ponechat interaktivní formulář (AcroForm)'}
                </span>
                {selectedMode === 'interactive' && (
                  <CheckCircle2
                    className={`w-4 h-4 ${
                      isMinimal ? 'text-blue-600' : isLcars ? 'text-[#ff9900]' : 'text-sky-400'
                    }`}
                  />
                )}
              </div>
              <p className="text-xs opacity-75 mt-1 leading-relaxed">
                {t.exportFormModal?.interactiveDesc ||
                  'Vyplněná data se uloží do formulářových polí. Formulář zůstane editovatelný v Adobe Acrobat i jiných PDF čtečkách.'}
              </p>
            </div>
          </div>

          {/* Option 2: Flattened Form */}
          <div
            onClick={() => setSelectedMode('flatten')}
            className={`p-4 rounded-xl border-2 cursor-pointer transition-all flex items-start gap-3.5 ${
              selectedMode === 'flatten'
                ? isMinimal
                  ? 'border-blue-600 bg-blue-50/70 shadow-sm'
                  : isLcars
                  ? 'border-[#ff9900] bg-[#ff9900]/15'
                  : 'border-sky-500 bg-sky-500/10 shadow-lg shadow-sky-950/40'
                : isMinimal
                ? 'border-neutral-200 hover:border-neutral-300 bg-white'
                : isLcars
                ? 'border-[#333333] hover:border-[#ff9900]/60 bg-black'
                : 'border-slate-800 hover:border-slate-700 bg-slate-950/40'
            }`}
          >
            <div
              className={`p-2 rounded-lg mt-0.5 ${
                selectedMode === 'flatten'
                  ? isMinimal
                    ? 'bg-blue-600 text-white'
                    : isLcars
                    ? 'bg-[#ff9900] text-black'
                    : 'bg-sky-500 text-slate-950'
                  : 'bg-slate-800/80 text-slate-400'
              }`}
            >
              <Lock className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold">
                  {t.exportFormModal?.flattenTitle || 'Zploštit formulář (Flatten into static PDF)'}
                </span>
                {selectedMode === 'flatten' && (
                  <CheckCircle2
                    className={`w-4 h-4 ${
                      isMinimal ? 'text-blue-600' : isLcars ? 'text-[#ff9900]' : 'text-sky-400'
                    }`}
                  />
                )}
              </div>
              <p className="text-xs opacity-75 mt-1 leading-relaxed">
                {t.exportFormModal?.flattenDesc ||
                  'Všechna data se trvale vypálí jako statický vektorový text. Vhodné pro finální archivaci a odeslání bez možnosti další změny.'}
              </p>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div
          className={`px-6 py-4 border-t flex items-center justify-end gap-3 ${
            isMinimal
              ? 'border-neutral-200 bg-neutral-50'
              : isLcars
              ? 'border-[#ff9900] bg-[#111111]'
              : 'border-slate-800 bg-slate-950/80'
          }`}
        >
          <button
            type="button"
            onClick={() => setIsExportFormModalOpen(false)}
            disabled={isExporting}
            className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors ${
              isMinimal
                ? 'text-neutral-600 hover:bg-neutral-200'
                : isLcars
                ? 'text-[#ff9900] hover:bg-[#ff9900]/20'
                : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            {t.exportFormModal?.cancel || 'Zrušit'}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isExporting}
            className={`flex items-center gap-2 px-5 py-2 rounded-lg text-xs font-bold shadow-lg transition-all ${
              isMinimal
                ? 'bg-black text-white hover:bg-neutral-800'
                : isLcars
                ? 'bg-[#ff9900] text-black hover:bg-[#ffcc00]'
                : 'bg-gradient-to-r from-sky-500 to-blue-600 text-white hover:from-sky-400 hover:to-blue-500 shadow-sky-950/50'
            }`}
          >
            <Download className="w-4 h-4" />
            {isExporting ? t.app.saving : (t.exportFormModal?.downloadBtn || 'Stáhnout PDF')}
          </button>
        </div>
      </div>
    </div>
  );
};
