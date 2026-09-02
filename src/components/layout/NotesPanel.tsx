import React, { useState, useMemo } from 'react';
import { useI18n } from '../../i18n/context';
import { useTheme } from '../../context/ThemeContext';
import { useDocument } from '../../context/DocumentContext';
import { useEditor } from '../../context/EditorContext';
import { Annotation, NoteAnnotation, TextAnnotation } from '../../types/annotations';
import { NoteDialog } from '../common/NoteDialog';
import {
  MessageSquare,
  Search,
  X,
  Trash2,
  Highlighter,
  Underline as UnderlineIcon,
  Strikethrough as StrikeIcon,
  Type,
  ChevronRight,
  Sparkles,
  Plus,
} from 'lucide-react';

export const NotesPanel: React.FC = () => {
  const { t } = useI18n();
  const { theme } = useTheme();
  const {
    annotations,
    pages,
    activePageIndex,
    setActivePageIndex,
    selectedAnnotationId,
    setSelectedAnnotationId,
    addAnnotation,
    updateAnnotation,
    deleteAnnotation,
  } = useDocument();

  const { isNotesPanelOpen, setIsNotesPanelOpen } = useEditor();

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);

  const isMinimal = theme === 'minimal';
  const isLcars = theme === 'lcars';

  // Collect all annotations that represent notes, comments, or text markups
  const reviewItems = useMemo(() => {
    return annotations.filter((ann) => {
      if (ann.type === 'note') return true;
      if (ann.type === 'text') return true;
      if (ann.type === 'highlight' || ann.type === 'underline' || ann.type === 'strikethrough') {
        return true;
      }
      return false;
    });
  }, [annotations]);

  // Filter items by search query
  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return reviewItems;
    const q = searchQuery.toLowerCase();
    return reviewItems.filter((ann) => {
      const text =
        ann.type === 'note'
          ? (ann as NoteAnnotation).text || ''
          : ann.type === 'text'
          ? (ann as TextAnnotation).text || ''
          : ann.comment || '';
      const author = ann.author || '';
      return text.toLowerCase().includes(q) || author.toLowerCase().includes(q);
    });
  }, [reviewItems, searchQuery]);

  if (!isNotesPanelOpen) return null;

  const handleSelectItem = (ann: Annotation) => {
    setSelectedAnnotationId(ann.id);
    const pageIndex = pages.findIndex((p) => p.id === ann.pageId);
    if (pageIndex !== -1 && pageIndex !== activePageIndex) {
      setActivePageIndex(pageIndex);
    }
  };

  const handleAddNewStickyNote = () => {
    const activePage = pages[activePageIndex];
    if (!activePage) return;

    const newNote: NoteAnnotation = {
      id: `note_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      pageId: activePage.id,
      type: 'note',
      x: 100,
      y: 100,
      width: 24,
      height: 24,
      opacity: 1,
      color: '#f59e0b',
      text: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    addAnnotation(newNote);
    setSelectedAnnotationId(newNote.id);
    setEditingCommentId(newNote.id);
  };

  const handleStartEditComment = (ann: Annotation) => {
    setEditingCommentId(ann.id);
  };

  const getItemTypeBadge = (type: string) => {
    switch (type) {
      case 'highlight':
        return {
          label: t.notesPanel.typeHighlight,
          icon: <Highlighter className={`w-3 h-3 ${isMinimal ? 'text-black' : isLcars ? 'text-[#ff9900]' : 'text-yellow-400'}`} />,
          colorClass: isMinimal ? 'bg-neutral-100 text-black border-neutral-300' : isLcars ? 'bg-[#111111] text-[#ff9900] border-[#ff9900]' : 'bg-yellow-950/60 text-yellow-300 border-yellow-800/60',
        };
      case 'underline':
        return {
          label: t.notesPanel.typeUnderline,
          icon: <UnderlineIcon className={`w-3 h-3 ${isMinimal ? 'text-black' : isLcars ? 'text-[#99ccff]' : 'text-sky-400'}`} />,
          colorClass: isMinimal ? 'bg-neutral-100 text-black border-neutral-300' : isLcars ? 'bg-[#111111] text-[#99ccff] border-[#99ccff]' : 'bg-sky-950/60 text-sky-300 border-sky-800/60',
        };
      case 'strikethrough':
        return {
          label: t.notesPanel.typeStrikethrough,
          icon: <StrikeIcon className={`w-3 h-3 ${isMinimal ? 'text-black' : isLcars ? 'text-[#cc3333]' : 'text-rose-400'}`} />,
          colorClass: isMinimal ? 'bg-neutral-100 text-black border-neutral-300' : isLcars ? 'bg-[#111111] text-[#cc3333] border-[#cc3333]' : 'bg-rose-950/60 text-rose-300 border-rose-800/60',
        };
      case 'note':
        return {
          label: t.notesPanel.typeNote,
          icon: <MessageSquare className={`w-3 h-3 ${isMinimal ? 'text-black' : isLcars ? 'text-[#ff9966]' : 'text-amber-400'}`} />,
          colorClass: isMinimal ? 'bg-neutral-100 text-black border-neutral-300' : isLcars ? 'bg-[#111111] text-[#ff9966] border-[#ff9966]' : 'bg-amber-950/60 text-amber-300 border-amber-800/60',
        };
      case 'text':
        return {
          label: t.notesPanel.typeText,
          icon: <Type className={`w-3 h-3 ${isMinimal ? 'text-black' : isLcars ? 'text-[#ffff66]' : 'text-emerald-400'}`} />,
          colorClass: isMinimal ? 'bg-neutral-100 text-black border-neutral-300' : isLcars ? 'bg-[#111111] text-[#ffff66] border-[#ffff66]' : 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60',
        };
      default:
        return {
          label: type,
          icon: <Sparkles className={`w-3 h-3 ${isMinimal ? 'text-black' : isLcars ? 'text-[#cc99cc]' : 'text-slate-400'}`} />,
          colorClass: isMinimal ? 'bg-neutral-100 text-black border-neutral-300' : isLcars ? 'bg-[#111111] text-[#cc99cc] border-[#cc99cc]' : 'bg-slate-800 text-slate-300 border-slate-700',
        };
    }
  };

  return (
    <aside
      className={`w-80 border-l flex flex-col h-full select-none z-20 shadow-2xl animate-in slide-in-from-right duration-200 transition-colors ${
        isMinimal
          ? 'bg-white border-neutral-200 text-black'
          : isLcars
          ? 'bg-black border-[#99ccff] text-[#ff9900]'
          : 'bg-slate-900/95 border-slate-800 text-white'
      }`}
    >
      {/* Panel Header */}
      <div
        className={`p-3 border-b flex items-center justify-between ${
          isMinimal ? 'border-neutral-200 bg-white' : isLcars ? 'border-[#333333] bg-black' : 'border-slate-800'
        }`}
      >
        <div className="flex items-center gap-2">
          <MessageSquare
            className={`w-4 h-4 ${
              isMinimal ? 'text-black' : isLcars ? 'text-[#ff9900]' : 'text-amber-400'
            }`}
          />
          <span
            className={`text-xs font-bold ${
              isMinimal ? 'text-black font-semibold' : isLcars ? 'text-[#ff9900] uppercase' : 'text-slate-200'
            }`}
          >
            {t.notesPanel.title}
          </span>
          <span
            className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
              isMinimal
                ? 'bg-neutral-100 text-black border border-neutral-300'
                : isLcars
                ? 'bg-black text-[#ff9900] border border-[#ff9900]'
                : 'bg-slate-800 text-amber-400 border border-slate-700'
            }`}
          >
            {reviewItems.length}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={handleAddNewStickyNote}
            className={`p-1 rounded-lg transition-colors ${
              isMinimal
                ? 'hover:bg-neutral-100 text-black'
                : isLcars
                ? 'hover:bg-[#222222] text-[#ff9900]'
                : 'hover:bg-slate-800 text-amber-400 hover:text-amber-300'
            }`}
            title={t.tools.note}
          >
            <Plus className="w-4 h-4" />
          </button>

          <button
            onClick={() => setIsNotesPanelOpen(false)}
            className={`p-1 rounded-lg transition-colors ${
              isMinimal
                ? 'hover:bg-neutral-100 text-neutral-500 hover:text-black'
                : isLcars
                ? 'hover:bg-[#222222] text-[#ff9966]'
                : 'hover:bg-slate-800 text-slate-400 hover:text-white'
            }`}
            title={t.notesPanel.togglePanel}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Search Input Filter */}
      <div
        className={`p-3 border-b ${
          isMinimal ? 'border-neutral-200 bg-neutral-50' : isLcars ? 'border-[#333333] bg-black' : 'border-slate-800 bg-slate-900/60'
        }`}
      >
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-2.5 top-2.5 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t.notesPanel.searchPlaceholder}
            className={`w-full pl-8 pr-7 py-1.5 text-xs outline-none transition-colors border ${
              isMinimal
                ? 'rounded-md bg-white border-neutral-300 text-black placeholder-neutral-400 focus:border-black'
                : isLcars
                ? 'rounded-full bg-black border-[#ff9966] text-[#ff9900] placeholder-[#aa6633] focus:border-[#ff9900]'
                : 'rounded-xl bg-slate-800/80 border-slate-700 text-slate-200 placeholder-slate-500 focus:border-amber-500'
            }`}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-2 p-0.5 text-neutral-400 hover:text-black"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Notes & Comments Scrollable List */}
      <div
        className={`flex-1 overflow-y-auto p-3 space-y-3 ${
          isMinimal ? 'bg-white' : ''
        }`}
      >
        {filteredItems.length === 0 ? (
          <div
            className={`py-12 text-center text-xs px-4 ${
              isMinimal ? 'text-neutral-400' : isLcars ? 'text-[#aa6633]' : 'text-slate-500'
            }`}
          >
            {searchQuery ? t.notesPanel.noSearchResults : t.notesPanel.noNotes}
          </div>
        ) : (
          filteredItems.map((ann) => {
            const isSelected = selectedAnnotationId === ann.id;
            const isEditing = editingCommentId === ann.id;
            const pageIdx = pages.findIndex((p) => p.id === ann.pageId);
            const badge = getItemTypeBadge(ann.type);

            const contentText =
              ann.type === 'note'
                ? (ann as NoteAnnotation).text || ''
                : ann.type === 'text'
                ? (ann as TextAnnotation).text || ''
                : ann.comment || '';

            return (
              <div
                key={ann.id}
                onClick={() => handleSelectItem(ann)}
                className={`group p-3 border transition-all cursor-pointer ${
                  isMinimal
                    ? isSelected
                      ? 'rounded-lg bg-neutral-50 border-2 border-black shadow-sm text-black'
                      : 'rounded-lg bg-white hover:bg-neutral-50 border border-neutral-200 text-black'
                    : isLcars
                    ? isSelected
                      ? 'rounded-2xl bg-[#111111] border-2 border-[#ff9900] shadow-[0_0_10px_rgba(255,153,0,0.3)]'
                      : 'rounded-2xl bg-black hover:bg-[#0a0a0a] border border-[#333333]'
                    : isSelected
                    ? 'rounded-xl bg-slate-800/90 border-amber-500/80 ring-1 ring-amber-500/50 shadow-md shadow-amber-950/20'
                    : 'rounded-xl bg-slate-800/40 hover:bg-slate-800 border-slate-700/60'
                }`}
              >
                {/* Item Header: Type Badge, Page Number, Delete Button */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold border ${badge.colorClass}`}
                    >
                      {badge.icon}
                      <span>{badge.label}</span>
                    </span>

                    <span
                      className={`text-[11px] font-semibold ${
                        isMinimal ? 'text-neutral-500' : isLcars ? 'text-[#cc99cc]' : 'text-slate-400'
                      }`}
                    >
                      {t.notesPanel.pageLabel} {pageIdx + 1}
                    </span>
                  </div>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteAnnotation(ann.id);
                    }}
                    className={`p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity ${
                      isMinimal
                        ? 'hover:bg-red-50 text-neutral-400 hover:text-red-600'
                        : isLcars
                        ? 'hover:bg-[#cc3333] text-[#cc3333] hover:text-white'
                        : 'text-slate-500 hover:text-rose-400'
                    }`}
                    title={t.notesPanel.deleteItem}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Comment / Note Content */}
                {isEditing ? (
                  <div className="mt-1" onClick={(e) => e.stopPropagation()}>
                    <NoteDialog
                      title={`${badge.label} • ${t.notesPanel.pageLabel} ${pageIdx + 1}`}
                      initialText={contentText}
                      placeholder={t.notesPanel.commentPlaceholder}
                      onSave={(txt) => {
                        if (ann.type === 'note' || ann.type === 'text') {
                          updateAnnotation({ ...ann, text: txt, updatedAt: Date.now() }, true);
                        } else {
                          updateAnnotation({ ...ann, comment: txt.trim() || undefined, updatedAt: Date.now() }, true);
                        }
                        setEditingCommentId(null);
                      }}
                      onCancel={() => {
                        setEditingCommentId(null);
                      }}
                      onDelete={() => {
                        deleteAnnotation(ann.id);
                        setEditingCommentId(null);
                      }}
                      positionClassName="relative"
                      widthClassName="w-full"
                    />
                  </div>
                ) : (
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSelectItem(ann);
                      handleStartEditComment(ann);
                    }}
                    className="group/text"
                  >
                    {contentText ? (
                      <p
                        className={`text-xs leading-relaxed line-clamp-4 transition-colors ${
                          isMinimal
                            ? 'text-neutral-800 hover:text-black font-medium'
                            : isLcars
                            ? 'text-[#ff9966] hover:text-[#ff9900]'
                            : 'text-slate-200 hover:text-amber-300'
                        }`}
                      >
                        {contentText}
                      </p>
                    ) : (
                      <span
                        className={`text-[11px] italic flex items-center gap-1 ${
                          isMinimal
                            ? 'text-neutral-400 hover:text-black'
                            : isLcars
                            ? 'text-[#aa6633] hover:text-[#ff9900]'
                            : 'text-slate-500 group-hover/text:text-amber-400'
                        }`}
                      >
                        <span>+ {t.notesPanel.addComment}</span>
                        <ChevronRight className="w-3 h-3 opacity-60" />
                      </span>
                    )}

                    {ann.author && (
                      <div
                        className={`mt-1.5 text-[10px] flex items-center justify-between ${
                          isMinimal ? 'text-neutral-400' : isLcars ? 'text-[#cc99cc]' : 'text-slate-500'
                        }`}
                      >
                        <span>{ann.author}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
};
