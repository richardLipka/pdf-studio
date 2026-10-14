import React from 'react';
import { useI18n } from '../../i18n/context';
import { useTheme } from '../../context/ThemeContext';
import { useEditor } from '../../context/EditorContext';
import {
  Keyboard,
  X,
  FileText,
  Edit3,
  ZoomIn,
  Navigation,
} from 'lucide-react';

interface ShortcutItem {
  keys: string[];
  description: string;
}

interface ShortcutGroup {
  title: string;
  icon: React.ReactNode;
  shortcuts: ShortcutItem[];
}

interface ShortcutsModalProps {
  open?: boolean;
  onClose?: () => void;
}

export const ShortcutsModal: React.FC<ShortcutsModalProps> = ({ open, onClose }) => {
  const { t } = useI18n();
  const { theme } = useTheme();
  const editor = useEditor();

  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : editor.isShortcutsModalOpen;

  const handleClose = () => {
    if (onClose) {
      onClose();
    } else {
      editor.setIsShortcutsModalOpen(false);
    }
  };

  if (!isOpen) return null;

  const isMinimal = theme === 'minimal';
  const isLcars = theme === 'lcars';
  const s = t.shortcutsModal;

  const groups: ShortcutGroup[] = [
    {
      title: s.groupDocument,
      icon: <FileText className="w-4 h-4 text-sky-400" />,
      shortcuts: [
        { keys: ['Ctrl', 'O'], description: s.openFile },
        { keys: ['Ctrl', 'S'], description: s.saveFile },
        { keys: ['Ctrl', 'Shift', 'S'], description: s.saveAs },
        { keys: ['Ctrl', 'N'], description: s.newDocument },
        { keys: ['Ctrl', 'W'], description: s.closeDocument },
        { keys: ['Ctrl', 'E'], description: s.flattenExport },
      ],
    },
    {
      title: s.groupEdit,
      icon: <Edit3 className="w-4 h-4 text-amber-400" />,
      shortcuts: [
        { keys: ['Ctrl', 'Z'], description: s.undo },
        { keys: ['Ctrl', 'Y'], description: s.redo },
        { keys: ['Ctrl', 'F'], description: s.find },
        { keys: ['Ctrl', 'A'], description: s.selectAll },
        { keys: ['Del'], description: s.deleteSelected },
      ],
    },
    {
      title: s.groupView,
      icon: <ZoomIn className="w-4 h-4 text-emerald-400" />,
      shortcuts: [
        { keys: ['Ctrl', '+'], description: s.zoomIn },
        { keys: ['Ctrl', '-'], description: s.zoomOut },
        { keys: ['Ctrl', '0'], description: s.zoomReset },
        { keys: ['Ctrl', '9'], description: s.fitPage },
        { keys: ['Ctrl', 'B'], description: s.toggleSidebar },
      ],
    },
    {
      title: s.groupNavigation,
      icon: <Navigation className="w-4 h-4 text-purple-400" />,
      shortcuts: [
        { keys: ['PageUp', 'PageDown'], description: s.pageNav },
        { keys: ['Shift', 'Click'], description: s.rangeSelect },
      ],
    },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div
        className={`w-full max-w-2xl max-h-[90vh] flex flex-col animate-in fade-in zoom-in-95 duration-200 border shadow-2xl overflow-hidden ${
          isMinimal
            ? 'rounded-2xl bg-white border-neutral-200 text-neutral-900'
            : isLcars
            ? 'rounded-2xl bg-black border-2 border-[#ff9900] shadow-[0_0_30px_rgba(255,153,0,0.4)] text-[#ff9900]'
            : 'rounded-2xl bg-slate-900 border-slate-700/80 text-white shadow-2xl'
        }`}
      >
        {/* Header */}
        <div
          className={`flex items-center justify-between px-6 py-4 border-b shrink-0 ${
            isMinimal
              ? 'border-neutral-200 bg-neutral-50/80'
              : isLcars
              ? 'border-[#ff9900]/40 bg-[#111111]'
              : 'border-slate-800 bg-slate-950/50'
          }`}
        >
          <div className="flex items-center gap-3">
            <div
              className={`p-2 rounded-xl flex items-center justify-center ${
                isMinimal
                  ? 'bg-neutral-100 text-neutral-800 border border-neutral-200'
                  : isLcars
                  ? 'bg-[#ff9900] text-black font-bold'
                  : 'bg-sky-500/20 text-sky-400 border border-sky-500/30'
              }`}
            >
              <Keyboard className="w-5 h-5" />
            </div>
            <div>
              <h2
                className={`text-lg font-bold tracking-tight ${
                  isLcars ? 'uppercase font-mono text-[#ff9900]' : ''
                }`}
              >
                {s.title}
              </h2>
              <p
                className={`text-xs ${
                  isMinimal
                    ? 'text-neutral-500'
                    : isLcars
                    ? 'text-[#ff9900]/70 font-mono'
                    : 'text-slate-400'
                }`}
              >
                {s.subtitle}
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className={`p-1.5 rounded-lg transition-colors ${
              isMinimal
                ? 'hover:bg-neutral-100 text-neutral-500'
                : isLcars
                ? 'hover:bg-[#ff9900] hover:text-black text-[#ff9900]'
                : 'hover:bg-slate-800 text-slate-400 hover:text-white'
            }`}
            title={s.close}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 overflow-y-auto">
          {groups.map((group, gIdx) => (
            <div key={gIdx} className="space-y-3">
              <div className="flex items-center gap-2">
                {group.icon}
                <h3
                  className={`text-sm font-semibold tracking-wider uppercase ${
                    isMinimal
                      ? 'text-neutral-600'
                      : isLcars
                      ? 'text-[#ff9900] font-mono'
                      : 'text-slate-300'
                  }`}
                >
                  {group.title}
                </h3>
              </div>

              <div
                className={`rounded-xl border divide-y overflow-hidden ${
                  isMinimal
                    ? 'bg-neutral-50/50 border-neutral-200 divide-neutral-200'
                    : isLcars
                    ? 'bg-[#111111] border-[#ff9900]/40 divide-[#ff9900]/20'
                    : 'bg-slate-800/40 border-slate-700/50 divide-slate-700/50'
                }`}
              >
                {group.shortcuts.map((sc, scIdx) => (
                  <div
                    key={scIdx}
                    className="flex items-center justify-between px-4 py-2.5 text-sm"
                  >
                    <span
                      className={
                        isMinimal
                          ? 'text-neutral-700'
                          : isLcars
                          ? 'text-neutral-300 font-mono'
                          : 'text-slate-200'
                      }
                    >
                      {sc.description}
                    </span>
                    <div className="flex items-center gap-1">
                      {sc.keys.map((k, kIdx) => (
                        <React.Fragment key={kIdx}>
                          {kIdx > 0 && (
                            <span
                              className={`text-xs px-0.5 ${
                                isMinimal
                                  ? 'text-neutral-400'
                                  : isLcars
                                  ? 'text-[#ff9900]/60'
                                  : 'text-slate-500'
                              }`}
                            >
                              +
                            </span>
                          )}
                          <kbd
                            className={`px-2 py-1 text-xs font-mono font-medium rounded-md shadow-sm border ${
                              isMinimal
                                ? 'bg-white border-neutral-300 text-neutral-800'
                                : isLcars
                                ? 'bg-black border-[#ff9900] text-[#ff9900]'
                                : 'bg-slate-700/80 border-slate-600 text-slate-100'
                            }`}
                          >
                            {k}
                          </kbd>
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div
          className={`px-6 py-3 border-t flex justify-end shrink-0 ${
            isMinimal
              ? 'border-neutral-200 bg-neutral-50/80'
              : isLcars
              ? 'border-[#ff9900]/40 bg-[#111111]'
              : 'border-slate-800 bg-slate-950/50'
          }`}
        >
          <button
            onClick={handleClose}
            className={`px-5 py-2 rounded-xl text-sm font-medium transition-colors ${
              isMinimal
                ? 'bg-neutral-800 text-white hover:bg-neutral-900'
                : isLcars
                ? 'bg-[#ff9900] text-black font-bold font-mono hover:bg-[#ffaa22]'
                : 'bg-sky-600 text-white hover:bg-sky-500'
            }`}
          >
            {s.close}
          </button>
        </div>
      </div>
    </div>
  );
};
