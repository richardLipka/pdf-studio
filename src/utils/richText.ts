import { BulletStyle } from '../types/annotations';

export interface TextSpan {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

export interface ParsedTextLine {
  spans: TextSpan[];
  isListItem?: boolean;
  listType?: 'bullet' | 'number';
  listIndex?: number;
}

/**
 * Returns the bullet character symbol corresponding to the bullet style
 */
export function getBulletSymbol(style?: BulletStyle): string {
  switch (style) {
    case 'square':
      return '▪';
    case 'dash':
      return '–';
    case 'arrow':
      return '▸';
    case 'disc':
    default:
      return '•';
  }
}

/**
 * Decodes basic HTML entities
 */
function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, '/');
}

/**
 * Parses inline HTML string into text spans with bold and italic flags
 */
function parseInlineHtml(html: string): TextSpan[] {
  const spans: TextSpan[] = [];
  // Tokenize by HTML tags: <b>, <strong>, <i>, <em>, </u>, </span>, etc.
  const tokenRegex = /(<\/?(?:b|strong|i|em|u|span)[^>]*>)/gi;
  const parts = html.split(tokenRegex);

  let isBold = false;
  let isItalic = false;

  for (const part of parts) {
    if (!part) continue;
    const lower = part.toLowerCase();
    if (lower === '<b>' || lower.startsWith('<b ') || lower === '<strong>' || lower.startsWith('<strong ')) {
      isBold = true;
    } else if (lower === '</b>' || lower === '</strong>') {
      isBold = false;
    } else if (lower === '<i>' || lower.startsWith('<i ') || lower === '<em>' || lower.startsWith('<em ')) {
      isItalic = true;
    } else if (lower === '</i>' || lower === '</em>') {
      isItalic = false;
    } else if (lower.startsWith('<span')) {
      if (lower.includes('font-weight: bold') || lower.includes('font-weight:bold') || lower.includes('font-weight: 700')) {
        isBold = true;
      }
      if (lower.includes('font-style: italic') || lower.includes('font-style:italic')) {
        isItalic = true;
      }
    } else if (lower === '</span>') {
      // span close - reset if we were only in span
    } else if (!part.startsWith('<')) {
      const decoded = decodeHtmlEntities(part);
      if (decoded.length > 0) {
        spans.push({
          text: decoded,
          bold: isBold || undefined,
          italic: isItalic || undefined,
        });
      }
    }
  }

  // Also support markdown syntax fallback: **bold** and *italic*
  if (spans.length === 0 && html) {
    return parseMarkdownSpans(decodeHtmlEntities(html));
  }

  return spans;
}

/**
 * Parses markdown inline tokens: **bold**, *italic*
 */
function parseMarkdownSpans(text: string): TextSpan[] {
  const spans: TextSpan[] = [];
  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*|[^*]+)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const chunk = match[0];
    if (chunk.startsWith('**') && chunk.endsWith('**') && chunk.length > 4) {
      spans.push({
        text: chunk.substring(2, chunk.length - 2),
        bold: true,
      });
    } else if (chunk.startsWith('*') && chunk.endsWith('*') && chunk.length > 2) {
      spans.push({
        text: chunk.substring(1, chunk.length - 1),
        italic: true,
      });
    } else {
      spans.push({
        text: chunk,
      });
    }
  }

  return spans.length > 0 ? spans : [{ text }];
}

/**
 * Parses rich text HTML or plain multiline text into structured lines
 */
export function parseRichTextToLines(
  plainText: string,
  richText?: string,
  bulletStyle: BulletStyle = 'disc'
): ParsedTextLine[] {
  const bulletSymbol = getBulletSymbol(bulletStyle);

  if (richText && richText.trim()) {
    // Normalize HTML
    let cleaned = richText
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/&nbsp;/g, ' ');

    const lines: ParsedTextLine[] = [];

    // Check if HTML contains list or block elements
    const hasBlocks = /<(p|div|ul|ol|li)[^>]*>/i.test(cleaned);

    if (hasBlocks) {
      // Match <ul>, <ol>, <p>, <div> blocks or loose text
      // Simple robust block parser for browser/Node
      const blockRegex = /<(ul|ol)[^>]*>([\s\S]*?)<\/\1>|<(p|div|li)[^>]*>([\s\S]*?)<\/\3>/gi;
      let match: RegExpExecArray | null;
      let matchedAny = false;

      while ((match = blockRegex.exec(cleaned)) !== null) {
        matchedAny = true;
        const listTag = match[1]?.toLowerCase();
        const listContent = match[2];
        const blockContent = match[4];

        if (listTag && listContent) {
          // Parse <li> items inside <ul> or <ol>
          const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
          let liMatch: RegExpExecArray | null;
          let itemIdx = 1;

          while ((liMatch = liRegex.exec(listContent)) !== null) {
            const rawLi = liMatch[1];
            const prefix = listTag === 'ol' ? `${itemIdx}. ` : `${bulletSymbol} `;
            const innerSpans = parseInlineHtml(rawLi);

            if (innerSpans.length > 0) {
              lines.push({
                spans: [{ text: prefix }, ...innerSpans],
                isListItem: true,
                listType: listTag === 'ol' ? 'number' : 'bullet',
                listIndex: itemIdx,
              });
            } else {
              lines.push({
                spans: [{ text: prefix }],
                isListItem: true,
                listType: listTag === 'ol' ? 'number' : 'bullet',
                listIndex: itemIdx,
              });
            }
            itemIdx++;
          }
        } else if (blockContent !== undefined) {
          const innerLines = blockContent.split('\n');
          for (const sub of innerLines) {
            const spans = parseInlineHtml(sub);
            if (spans.length > 0) {
              lines.push({ spans });
            }
          }
        }
      }

      if (matchedAny && lines.length > 0) {
        return lines;
      }
    }

    // Fallback: Split by newline
    const rawLines = cleaned.replace(/<[^>]+>/g, '').split('\n');
    return rawLines.map((line) => ({
      spans: parseMarkdownSpans(decodeHtmlEntities(line)),
    }));
  }

  // Pure plain text fallback
  const lines = (plainText || '').split('\n');
  return lines.map((l) => {
    // Check if line begins with bullet or numbering
    const trimmed = l.trimStart();
    if (/^[•▪–▸\-\*]\s/.test(trimmed)) {
      const rest = trimmed.substring(2);
      return {
        spans: [{ text: `${bulletSymbol} ` }, ...parseMarkdownSpans(rest)],
        isListItem: true,
        listType: 'bullet',
      };
    }

    const numMatch = /^(\d+)\.\s(.*)/.exec(trimmed);
    if (numMatch) {
      return {
        spans: [{ text: `${numMatch[1]}. ` }, ...parseMarkdownSpans(numMatch[2])],
        isListItem: true,
        listType: 'number',
        listIndex: parseInt(numMatch[1], 10),
      };
    }

    return {
      spans: parseMarkdownSpans(l),
    };
  });
}

/**
 * Converts parsed lines to plain text representation with newlines
 */
export function linesToPlainText(lines: ParsedTextLine[]): string {
  return lines
    .map((line) => line.spans.map((s) => s.text).join(''))
    .join('\n');
}

/**
 * Converts plain text to HTML for contentEditable initialization
 */
export function formatPlainTextToHtml(text: string): string {
  if (!text) return '';
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped.replace(/\n/g, '<br>');
}
