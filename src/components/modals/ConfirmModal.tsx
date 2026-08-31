import React from 'react';
import { useI18n } from '../../i18n/context';
import { useEditor } from '../../context/EditorContext';
import { useDocument } from '../../context/DocumentContext';
import { AlertTriangle, Trash2 } from 'lucide-react';

export const ConfirmModal: React.FC = () => {
  const { t } = useI18n();
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

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl p-6 flex flex-col space-y-4 animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center gap-3 text-rose-400">
          <div className="p-2 rounded-xl bg-rose-500/20 border border-rose-500/30">
            <AlertTriangle className="w-6 h-6 text-rose-400" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">
              {isMultiple
                ? t.confirmModal.deleteMultipleTitle
                : t.confirmModal.deletePageTitle}
            </h3>
          </div>
        </div>

        <p className="text-xs text-slate-300 leading-relaxed">
          {isMultiple
            ? t.confirmModal.deleteMultipleMsg.replace('{count}', String(selectedPageIds.length))
            : t.confirmModal.deletePageMsg}
        </p>

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            onClick={handleCancel}
            className="px-4 py-2 text-xs font-semibold rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
          >
            {t.confirmModal.cancel}
          </button>

          <button
            onClick={handleConfirm}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-xl bg-rose-600 hover:bg-rose-500 text-white shadow-md shadow-rose-600/20 active:scale-95 transition-all"
          >
            <Trash2 className="w-4 h-4" />
            <span>{t.confirmModal.confirm}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
