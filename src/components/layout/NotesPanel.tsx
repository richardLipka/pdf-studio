import React, { useState, useMemo } from 'react';
import { useI18n } from '../../i18n/context';
import { useDocument } from '../../context/DocumentContext';
import { useEditor } from '../../context/EditorContext';
import { Annotation, NoteAnnotation, TextAnnotation } from '../../types/annotations';
import {
  MessageSquare,
  Search,
  X,
  Trash2,
  Highlighter,
  Underline as UnderlineIcon,
  Strikethrough as StrikeIcon,
  Type,
  Check,
  ChevronRight,
  Sparkles,
  Plus,
} from 'lucide-react';

export const NotesPanel: React.FC = () => {
  const { t } = useI18n();
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
  const [commentDraft, setCommentDraft] = useState<string>('');

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
    const q = searchQuery.toLowerCase().trim();

    return reviewItems.filter((ann) => {
      const pageIdx = pages.findIndex((p) => p.id === ann.pageId);
      const pageNumStr = pageIdx !== -1 ? String(pageIdx + 1) : '';

      const content =
        ann.type === 'note'
          ? (ann as NoteAnnotation).text || ''
          : ann.type === 'text'
          ? (ann as TextAnnotation).text || ''
          : ann.comment || '';

      const author = ann.author || '';
      const typeStr = ann.type.toLowerCase();

      return (
        content.toLowerCase().includes(q) ||
        author.toLowerCase().includes(q) ||
        pageNumStr.includes(q) ||
        typeStr.includes(q)
      );
    });
  }, [reviewItems, searchQuery, pages]);

  if (!isNotesPanelOpen) return null;

  const handleSelectItem = (ann: Annotation) => {
    setSelectedAnnotationId(ann.id);
    const pageIdx = pages.findIndex((p) => p.id === ann.pageId);
    if (pageIdx !== -1) {
      setActivePageIndex(pageIdx);
    }
  };

  const handleAddNewStickyNote = () => {
    // If an annotation is already selected, attach or edit the comment on that annotation
    if (selectedAnnotationId) {
      const selectedAnn = annotations.find((a) => a.id === selectedAnnotationId);
      if (selectedAnn) {
        handleStartEditComment(selectedAnn);
        return;
      }
    }

    const activePage = pages[activePageIndex] || pages[0];
    if (!activePage) return;

    const newNote: NoteAnnotation = {
      id: `note_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      pageId: activePage.id,
      type: 'note',
      x: 80,
      y: 80,
      width: 24,
      height: 24,
      color: '#f59e0b',
      opacity: 1.0,
      text: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    addAnnotation(newNote);
    setSelectedAnnotationId(newNote.id);
    setEditingCommentId(newNote.id);
    setCommentDraft('');
  };

  const handleStartEditComment = (ann: Annotation) => {
    setEditingCommentId(ann.id);
    const currentText =
      ann.type === 'note'
        ? (ann as NoteAnnotation).text || ''
        : ann.type === 'text'
        ? (ann as TextAnnotation).text || ''
        : ann.comment || '';
    setCommentDraft(currentText);
  };

  const handleSaveComment = (ann: Annotation) => {
    if (ann.type === 'note') {
      updateAnnotation({ ...ann, text: commentDraft, updatedAt: Date.now() }, true);
    } else if (ann.type === 'text') {
      updateAnnotation({ ...ann, text: commentDraft, updatedAt: Date.now() }, true);
    } else {
      updateAnnotation({ ...ann, comment: commentDraft, updatedAt: Date.now() }, true);
    }
    setEditingCommentId(null);
  };

  const getItemTypeBadge = (type: string) => {
    switch (type) {
      case 'highlight':
        return {
          label: t.notesPanel.typeHighlight,
          icon: <Highlighter className="w-3 h-3 text-yellow-400" />,
          colorClass: 'bg-yellow-950/60 text-yellow-300 border-yellow-800/60',
        };
      case 'underline':
        return {
          label: t.notesPanel.typeUnderline,
          icon: <UnderlineIcon className="w-3 h-3 text-sky-400" />,
          colorClass: 'bg-sky-950/60 text-sky-300 border-sky-800/60',
        };
      case 'strikethrough':
        return {
          label: t.notesPanel.typeStrikethrough,
          icon: <StrikeIcon className="w-3 h-3 text-rose-400" />,
          colorClass: 'bg-rose-950/60 text-rose-300 border-rose-800/60',
        };
      case 'note':
        return {
          label: t.notesPanel.typeNote,
          icon: <MessageSquare className="w-3 h-3 text-amber-400" />,
          colorClass: 'bg-amber-950/60 text-amber-300 border-amber-800/60',
        };
      case 'text':
        return {
          label: t.notesPanel.typeText,
          icon: <Type className="w-3 h-3 text-emerald-400" />,
          colorClass: 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60',
        };
      default:
        return {
          label: type,
          icon: <Sparkles className="w-3 h-3 text-slate-400" />,
          colorClass: 'bg-slate-800 text-slate-300 border-slate-700',
        };
    }
  };

  return (
    <aside className="w-80 bg-slate-900/95 border-l border-slate-800 flex flex-col h-full select-none z-20 shadow-2xl animate-in slide-in-from-right duration-200">
      {/* Panel Header */}
      <div className="p-3 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-amber-400" />
          <span className="text-xs font-bold text-slate-200">
            {t.notesPanel.title}
          </span>
          <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-amber-400 border border-slate-700">
            {reviewItems.length}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={handleAddNewStickyNote}
            className="p-1 rounded-lg hover:bg-slate-800 text-amber-400 hover:text-amber-300 transition-colors"
            title={t.tools.note}
          >
            <Plus className="w-4 h-4" />
          </button>

          <button
            onClick={() => setIsNotesPanelOpen(false)}
            className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
            title={t.notesPanel.togglePanel}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Search Input Filter */}
      <div className="p-3 border-b border-slate-800 bg-slate-900/60">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t.notesPanel.searchPlaceholder}
            className="w-full bg-slate-800/80 border border-slate-700 rounded-xl pl-8 pr-7 py-1.5 text-xs text-slate-200 placeholder-slate-500 outline-none focus:border-amber-500 transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-2 p-0.5 text-slate-500 hover:text-slate-300"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Notes & Comments Scrollable List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 scrollbar-thin scrollbar-thumb-slate-700">
        {filteredItems.length === 0 ? (
          <div className="py-12 text-center text-xs text-slate-500 px-4">
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
                className={`group rounded-xl p-3 border transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-slate-800/90 border-amber-500/80 ring-1 ring-amber-500/50 shadow-md shadow-amber-950/20'
                    : 'bg-slate-800/40 hover:bg-slate-800 border-slate-700/60'
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

                    <span className="text-[11px] font-semibold text-slate-400">
                      {t.notesPanel.pageLabel} {pageIdx + 1}
                    </span>
                  </div>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteAnnotation(ann.id);
                    }}
                    className="p-1 rounded text-slate-500 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-opacity"
                    title={t.notesPanel.deleteItem}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Comment / Note Content */}
                {isEditing ? (
                  <div className="space-y-2 mt-1" onClick={(e) => e.stopPropagation()}>
                    <textarea
                      value={commentDraft}
                      onChange={(e) => setCommentDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSaveComment(ann);
                        } else if (e.key === 'Escape') {
                          e.preventDefault();
                          setEditingCommentId(null);
                        }
                      }}
                      placeholder={t.notesPanel.commentPlaceholder}
                      rows={3}
                      className="w-full text-xs bg-slate-900 border border-amber-500/60 rounded-lg p-2 text-slate-100 placeholder-slate-500 outline-none resize-none"
                      autoFocus
                    />

                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => setEditingCommentId(null)}
                        className="px-2.5 py-1 rounded text-[11px] text-slate-400 hover:text-white"
                      >
                        {t.addPageModal.cancel}
                      </button>
                      <button
                        onClick={() => handleSaveComment(ann)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-[11px]"
                      >
                        <Check className="w-3 h-3" />
                        <span>{t.annotations.saveNote}</span>
                      </button>
                    </div>
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
                      <p className="text-xs text-slate-200 leading-relaxed line-clamp-4 hover:text-amber-300 transition-colors">
                        {contentText}
                      </p>
                    ) : (
                      <span className="text-[11px] text-slate-500 italic flex items-center gap-1 group-hover/text:text-amber-400">
                        <span>+ {t.notesPanel.addComment}</span>
                        <ChevronRight className="w-3 h-3 opacity-60" />
                      </span>
                    )}

                    {ann.author && (
                      <div className="mt-1.5 text-[10px] text-slate-500 flex items-center justify-between">
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
