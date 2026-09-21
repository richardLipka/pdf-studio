import React, { useState, useRef, useEffect } from 'react';
import { TextAnnotation, BulletStyle } from '../../types/annotations';
import { formatPlainTextToHtml } from '../../utils/richText';
import {
  GripHorizontal,
  Check,
  Trash2,
  Bold,
  Italic,
  List,
  ListOrdered,
  Minimize2,
  ChevronDown,
} from 'lucide-react';

interface TextAnnotationItemProps {
  annotation: TextAnnotation;
  isSelected: boolean;
  scale: number;
  pageWidth: number;
  isMinimal: boolean;
  isLcars: boolean;
  t: any;
  onUpdate: (updated: TextAnnotation, commitHistory?: boolean) => void;
  onDelete: (id: string) => void;
  onSelect: (id: string) => void;
  onStartDrag: (ann: TextAnnotation, e: React.MouseEvent) => void;
  onStartResize: (id: string, e: React.MouseEvent) => void;
}

export const TextAnnotationItem: React.FC<TextAnnotationItemProps> = ({
  annotation,
  isSelected,
  scale,
  pageWidth,
  isMinimal,
  isLcars,
  t,
  onUpdate,
  onDelete,
  onSelect,
  onStartDrag,
  onStartResize,
}) => {
  const editableRef = useRef<HTMLDivElement>(null);
  const [showBulletMenu, setShowBulletMenu] = useState(false);
  const bulletStyle: BulletStyle = annotation.bulletStyle || 'disc';

  const left = annotation.x * scale;
  const top = annotation.y * scale;
  const width = Math.max(50, annotation.width * scale);
  const height = Math.max(24, annotation.height * scale);

  const fontSize = (annotation.fontSize || 14) * scale;
  const fontFamily = annotation.fontFamily || 'Inter';
  const color = annotation.color || '#0f172a';

  // Initialize innerHTML only when mounting or when selection starts
  useEffect(() => {
    if (editableRef.current) {
      const initialHtml = annotation.richText || formatPlainTextToHtml(annotation.text) || '';
      if (editableRef.current.innerHTML !== initialHtml && !isSelected) {
        editableRef.current.innerHTML = initialHtml;
      } else if (isSelected && !editableRef.current.innerHTML) {
        editableRef.current.innerHTML = initialHtml;
      }
    }
  }, [isSelected, annotation.id]);

  // Focus and select range if newly placed empty textbox
  useEffect(() => {
    if (isSelected && editableRef.current && !annotation.text) {
      editableRef.current.focus();
    }
  }, [isSelected]);

  const handleSync = (commitHistory = false) => {
    if (!editableRef.current) return;
    const html = editableRef.current.innerHTML;
    const plainText = editableRef.current.innerText || '';

    // Auto-expand height if content overflows
    const scrollH = editableRef.current.scrollHeight;
    let newHeight = annotation.height;
    if (scrollH > height + 2) {
      newHeight = Math.ceil(scrollH / scale);
    }

    onUpdate(
      {
        ...annotation,
        text: plainText,
        richText: html,
        height: newHeight,
        updatedAt: Date.now(),
      },
      commitHistory
    );
  };

  const handleFitToText = () => {
    if (!editableRef.current) return;
    const el = editableRef.current;

    // Clone element to measure tight content dimensions
    const clone = el.cloneNode(true) as HTMLElement;
    clone.style.width = 'auto';
    clone.style.height = 'auto';
    clone.style.display = 'inline-block';
    clone.style.position = 'absolute';
    clone.style.visibility = 'hidden';
    clone.style.whiteSpace = 'pre-wrap';
    clone.style.wordBreak = 'break-word';
    clone.style.maxWidth = `${pageWidth * scale}px`;
    clone.style.padding = '4px 6px';
    document.body.appendChild(clone);

    const measuredW = Math.ceil((clone.offsetWidth + 12) / scale);
    const measuredH = Math.ceil((clone.offsetHeight + 6) / scale);
    document.body.removeChild(clone);

    onUpdate(
      {
        ...annotation,
        width: Math.max(50, measuredW),
        height: Math.max(24, measuredH),
        updatedAt: Date.now(),
      },
      true
    );
  };

  const execFormatting = (cmd: string, val: string | undefined = undefined) => {
    if (editableRef.current) {
      editableRef.current.focus();
    }
    document.execCommand(cmd, false, val);
    handleSync(false);
  };

  const handleBulletStyleSelect = (style: BulletStyle) => {
    setShowBulletMenu(false);
    onUpdate(
      {
        ...annotation,
        bulletStyle: style,
        updatedAt: Date.now(),
      },
      true
    );
  };

  // Get CSS list style for unordered list based on bulletStyle
  const getListStyleClass = () => {
    switch (bulletStyle) {
      case 'square':
        return 'bullet-square';
      case 'dash':
        return 'bullet-dash';
      case 'arrow':
        return 'bullet-arrow';
      case 'disc':
      default:
        return 'bullet-disc';
    }
  };

  const bgStyle =
    annotation.backgroundColor && annotation.backgroundColor !== 'transparent'
      ? annotation.backgroundColor
      : 'transparent';

  const borderStyle =
    annotation.borderWidth && annotation.borderWidth > 0
      ? `${annotation.borderWidth * scale}px solid ${annotation.borderColor || '#000000'}`
      : 'none';

  return (
    <div
      className={`annotation-item absolute group select-none transition-all ${
        isSelected
          ? 'z-40 ring-1 ring-sky-500/80 border border-dashed border-sky-400 rounded shadow-xs'
          : 'z-20 hover:ring-1 hover:ring-sky-400/40 rounded-none cursor-pointer'
      }`}
      style={{
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`,
        backgroundColor: bgStyle,
        border: borderStyle,
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (!isSelected) {
          onSelect(annotation.id);
        }
      }}
      onMouseDown={(e) => {
        if (!isSelected) {
          onStartDrag(annotation, e);
        }
      }}
    >
      {/* FLOATING ACTION TOOLBAR (When Selected) */}
      {isSelected && (
        <div
          className={`absolute -top-10 left-0 flex items-center gap-1 px-1.5 py-1 rounded-lg shadow-xl border backdrop-blur-md z-50 select-none animate-in fade-in zoom-in-95 duration-100 ${
            isMinimal
              ? 'bg-white/95 border-neutral-300 text-black shadow-neutral-400/50'
              : isLcars
              ? 'bg-black/95 border border-[#ff9900] text-[#ff9900]'
              : 'bg-slate-900/95 border-slate-700 text-slate-100 shadow-slate-950/80'
          }`}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Drag to Move */}
          <div
            onMouseDown={(e) => onStartDrag(annotation, e)}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded cursor-grab active:cursor-grabbing hover:bg-slate-800 text-slate-300 hover:text-white transition-colors"
            title={t.annotations.dragToMove}
          >
            <GripHorizontal className="w-3.5 h-3.5 text-sky-400" />
          </div>

          <div className="h-3.5 w-px bg-slate-700 mx-0.5" />

          {/* Bold Button (Ctrl+B) */}
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              execFormatting('bold');
            }}
            className="p-1 rounded hover:bg-slate-800 hover:text-white text-slate-300 transition-colors"
            title={t.annotations.bold}
          >
            <Bold className="w-3.5 h-3.5" />
          </button>

          {/* Italic Button (Ctrl+I) */}
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              execFormatting('italic');
            }}
            className="p-1 rounded hover:bg-slate-800 hover:text-white text-slate-300 transition-colors"
            title={t.annotations.italic}
          >
            <Italic className="w-3.5 h-3.5" />
          </button>

          {/* Bullet List Button */}
          <div className="relative flex items-center">
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                execFormatting('insertUnorderedList');
              }}
              className="p-1 rounded-l hover:bg-slate-800 hover:text-white text-slate-300 transition-colors"
              title={t.annotations.bulletList}
            >
              <List className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setShowBulletMenu((prev) => !prev);
              }}
              className="p-0.5 rounded-r hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
              title={t.annotations.bulletShape}
            >
              <ChevronDown className="w-2.5 h-2.5" />
            </button>

            {/* Bullet Shape Dropdown */}
            {showBulletMenu && (
              <div
                className={`absolute top-full left-0 mt-1 py-1 px-1 rounded-md shadow-xl border z-50 flex flex-col gap-0.5 min-w-[90px] ${
                  isMinimal
                    ? 'bg-white border-neutral-300 text-black'
                    : isLcars
                    ? 'bg-black border-[#ff9900] text-[#ff9900]'
                    : 'bg-slate-800 border-slate-700 text-slate-200'
                }`}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={() => handleBulletStyleSelect('disc')}
                  className={`text-left px-2 py-0.5 text-xs rounded hover:bg-sky-600 hover:text-white ${
                    bulletStyle === 'disc' ? 'font-bold text-sky-400' : ''
                  }`}
                >
                  {t.annotations.bulletDisc}
                </button>
                <button
                  type="button"
                  onClick={() => handleBulletStyleSelect('square')}
                  className={`text-left px-2 py-0.5 text-xs rounded hover:bg-sky-600 hover:text-white ${
                    bulletStyle === 'square' ? 'font-bold text-sky-400' : ''
                  }`}
                >
                  {t.annotations.bulletSquare}
                </button>
                <button
                  type="button"
                  onClick={() => handleBulletStyleSelect('dash')}
                  className={`text-left px-2 py-0.5 text-xs rounded hover:bg-sky-600 hover:text-white ${
                    bulletStyle === 'dash' ? 'font-bold text-sky-400' : ''
                  }`}
                >
                  {t.annotations.bulletDash}
                </button>
                <button
                  type="button"
                  onClick={() => handleBulletStyleSelect('arrow')}
                  className={`text-left px-2 py-0.5 text-xs rounded hover:bg-sky-600 hover:text-white ${
                    bulletStyle === 'arrow' ? 'font-bold text-sky-400' : ''
                  }`}
                >
                  {t.annotations.bulletArrow}
                </button>
              </div>
            )}
          </div>

          {/* Numbered List Button */}
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              execFormatting('insertOrderedList');
            }}
            className="p-1 rounded hover:bg-slate-800 hover:text-white text-slate-300 transition-colors"
            title={t.annotations.numberedList}
          >
            <ListOrdered className="w-3.5 h-3.5" />
          </button>

          <div className="h-3.5 w-px bg-slate-700 mx-0.5" />

          {/* Fit Box to Text Content Button */}
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleFitToText();
            }}
            className="p-1 rounded hover:bg-sky-600/30 text-sky-400 hover:text-sky-200 transition-colors"
            title={t.annotations.fitToText}
          >
            <Minimize2 className="w-3.5 h-3.5" />
          </button>

          <div className="h-3.5 w-px bg-slate-700 mx-0.5" />

          {/* Done Button */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleSync(true);
              onSelect('');
            }}
            className={`flex items-center gap-1 px-2 py-0.5 text-xs font-bold rounded shadow-xs transition-all ${
              isMinimal
                ? 'bg-black text-white hover:bg-neutral-800'
                : isLcars
                ? 'bg-[#ff9900] text-black hover:bg-[#ffaa22]'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white'
            }`}
            title={t.annotations.done}
          >
            <Check className="w-3.5 h-3.5" />
            <span>{t.annotations.done}</span>
          </button>

          <div className="h-3.5 w-px bg-slate-700 mx-0.5" />

          {/* Delete Button */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(annotation.id);
            }}
            className="p-1 rounded hover:bg-rose-600/30 text-rose-400 hover:text-rose-200 transition-colors"
            title={t.annotations.deleteAnnotation}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* RICH MULTILINE CONTENTEDITABLE AREA */}
      <div
        ref={editableRef}
        contentEditable={isSelected}
        suppressContentEditableWarning
        onInput={() => handleSync(false)}
        onBlur={() => handleSync(true)}
        onMouseDown={(e) => {
          if (isSelected) {
            e.stopPropagation();
          }
        }}
        onKeyDown={(e) => {
          // Shift + Enter -> Insert explicit line break
          if (e.key === 'Enter' && e.shiftKey) {
            e.preventDefault();
            document.execCommand('insertLineBreak');
            handleSync(false);
            return;
          }
          // Escape -> Close editing
          if (e.key === 'Escape') {
            e.preventDefault();
            editableRef.current?.blur();
            handleSync(true);
            onSelect('');
          }
        }}
        style={{
          fontSize: `${fontSize}px`,
          fontFamily,
          color,
          lineHeight: '1.25',
          textAlign: 'left',
        }}
        className={`w-full h-full px-1.5 py-1 outline-none break-words overflow-wrap-anywhere whitespace-pre-wrap select-text cursor-text ${getListStyleClass()} ${
          !annotation.text && isSelected ? 'empty-text-placeholder' : ''
        }`}
        data-placeholder={t.annotations.textPlaceholder}
      />

      {/* SELECTION RESIZE HANDLES */}
      {isSelected && (
        <>
          {/* Bottom-right Corner 2D Resize Handle */}
          <div
            onMouseDown={(e) => {
              e.stopPropagation();
              onStartResize(annotation.id, e);
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              handleFitToText();
            }}
            className="absolute -bottom-1.5 -right-1.5 w-3.5 h-3.5 bg-sky-500 hover:bg-sky-400 border-2 border-white rounded-full cursor-se-resize shadow-md transition-transform hover:scale-125 z-40"
            title={`${t.annotations.resize} (${t.annotations.fitToText})`}
          />

          {/* Right Edge Width Resize Handle */}
          <div
            onMouseDown={(e) => {
              e.stopPropagation();
              onStartResize(annotation.id, e);
            }}
            className="absolute top-1/2 -right-1 -translate-y-1/2 w-2 h-4 bg-sky-500 hover:bg-sky-400 border border-white rounded-xs cursor-e-resize shadow-xs z-40"
            title={t.annotations.resize}
          />
        </>
      )}
    </div>
  );
};
