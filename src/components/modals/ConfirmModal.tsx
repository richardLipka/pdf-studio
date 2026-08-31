import React from 'react';
import { useI18n } from '../../i18n/context';
import { useTheme } from '../../context/ThemeContext';
import { useEditor } from '../../context/EditorContext';
import { useDocument } from '../../context/DocumentContext';
import { AlertTriangle, Trash2 } from 'lucide-react';

export const ConfirmModal: React.FC = () => {
  const { t } = useI18n();
  const { theme } = useTheme();
  const {
    isDeleteConfirmModalOpen,
    setIsDeleteConfirmModalOpen,
    deleteTargetPageId,
    setDeleteTargetPageId,
    deleteMode,
  } = useEditor();

  const { deletePageById, deleteSelectedPages, selectedPageIds } = useDocument();

  React.useEffect(() => {
    if (!isDeleteConfirmModalOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleConfirm();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleCancel();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isDeleteConfirmModalOpen, deleteMode, selectedPageIds, deleteTargetPageId]);

  if (!isDeleteConfirmModalOpen) return null;

  const isMultiple = deleteMode === 'multiple' && selectedPageIds.length > 1;

  const handleConfirm = () => {
    if (isMultiple) {
      deleteSelectedPages();
    } else if (deleteTargetPageId) {
      deletePageById(deleteTargetPageId);
    }
    setIsDeleteConfirmModalOpen(false);
    setDeleteTargetPageId(null);
  };

  const handleCancel = () => {
    setIsDeleteConfirmModalOpen(false);
    setDeleteTargetPageId(null);
  };

  const isMinimal = theme === 'minimal';
  const isLcars = theme === 'lcars';

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div
        className={`w-full max-w-md p-6 flex flex-col space-y-4 animate-in fade-in zoom-in-95 duration-200 border ${
          isMinimal
            ? 'rounded-xl bg-white border-neutral-200 shadow-xl text-black'
            : isLcars
            ? 'rounded-2xl bg-black border-2 border-[#cc3333] shadow-[0_0_20px_rgba(204,51,51,0.5)] text-[#ff9900]'
            : 'rounded-2xl bg-slate-900 border-slate-700 shadow-2xl text-white'
        }`}
      >
        <div className="flex items-center gap-3">
          <div
            className={`p-2 ${
              isMinimal
                ? 'rounded-lg bg-red-50 text-red-600 border border-red-200'
                : isLcars
                ? 'rounded-full bg-[#cc3333] text-white'
                : 'rounded-xl bg-rose-500/20 border border-rose-500/30 text-rose-400'
            }`}
          >
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div>
            <h3
              className={`text-base font-bold ${
                isMinimal ? 'text-black font-semibold' : isLcars ? 'text-[#ff9900] uppercase' : 'text-white'
              }`}
            >
              {isMultiple
                ? `${t.confirmModal.deleteMultipleTitle} (${selectedPageIds.length})`
                : t.confirmModal.deletePageTitle}
            </h3>
          </div>
        </div>

        <p
          className={`text-xs leading-relaxed ${
            isMinimal ? 'text-neutral-600' : isLcars ? 'text-[#ff9966]' : 'text-slate-300'
          }`}
        >
          {isMultiple
            ? t.confirmModal.deleteMultipleMsg.replace('{count}', String(selectedPageIds.length))
            : t.confirmModal.deletePageMsg}
        </p>

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            onClick={handleCancel}
            className={`px-4 py-2 text-xs font-semibold transition-colors ${
              isMinimal
                ? 'rounded-md bg-white hover:bg-neutral-100 text-black border border-neutral-300'
                : isLcars
                ? 'rounded-full bg-[#111111] hover:bg-[#222222] text-[#ff9966] border border-[#ff9966]'
                : 'rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700'
            }`}
          >
            {t.confirmModal.cancel}
          </button>

          <button
            onClick={handleConfirm}
            className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold active:scale-95 transition-all ${
              isMinimal
                ? 'rounded-md bg-red-600 hover:bg-red-700 text-white border border-red-600'
                : isLcars
                ? 'rounded-full bg-[#cc3333] hover:bg-[#ff3333] text-white uppercase'
                : 'rounded-xl bg-rose-600 hover:bg-rose-500 text-white shadow-md shadow-rose-600/20'
            }`}
          >
            <Trash2 className="w-4 h-4" />
            <span>
              {isMultiple
                ? `${t.confirmModal.confirm} (${selectedPageIds.length})`
                : t.confirmModal.confirm}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
