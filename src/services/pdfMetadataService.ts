import { PDFDict, PDFDocument, PDFHexString, PDFName } from 'pdf-lib';
import { DocumentMetadata, RESERVED_METADATA_KEYS } from '../types/document';

/**
 * PDF Document Information Dictionary and XMP metadata serialization (ISO 32000-1 §14.3).
 * Extracted from pdfExporter.ts so metadata / XMP logic is isolated and independently reusable.
 */

const xmlEscape = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Characters XML 1.0 does not allow
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

const validDate = (iso?: string): Date | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
};

/** XMP packet mirroring the document information, so XMP-first readers show the same values */
export const buildXmpPacket = (metadata: DocumentMetadata, created: Date | null, modified: Date): string => {
  const lines: string[] = [];
  const alt = (tag: string, value?: string) => {
    if (value) {
      lines.push(`   <${tag}><rdf:Alt><rdf:li xml:lang="x-default">${xmlEscape(value)}</rdf:li></rdf:Alt></${tag}>`);
    }
  };
  const simple = (tag: string, value?: string) => {
    if (value) lines.push(`   <${tag}>${xmlEscape(value)}</${tag}>`);
  };
  lines.push('   <dc:format>application/pdf</dc:format>');
  alt('dc:title', metadata.title);
  if (metadata.author) {
    const authors = metadata.author.split(/\s*;\s*/).filter(Boolean);
    lines.push(
      `   <dc:creator><rdf:Seq>${authors.map((a) => `<rdf:li>${xmlEscape(a)}</rdf:li>`).join('')}</rdf:Seq></dc:creator>`
    );
  }
  alt('dc:description', metadata.subject);
  const keywords = (metadata.keywords || '')
    .split(/[,;]/)
    .map((k) => k.trim())
    .filter(Boolean);
  if (keywords.length > 0) {
    lines.push(
      `   <dc:subject><rdf:Bag>${keywords.map((k) => `<rdf:li>${xmlEscape(k)}</rdf:li>`).join('')}</rdf:Bag></dc:subject>`
    );
  }
  simple('dc:source', metadata.source);
  if (metadata.language) {
    lines.push(`   <dc:language><rdf:Bag><rdf:li>${xmlEscape(metadata.language)}</rdf:li></rdf:Bag></dc:language>`);
  }
  simple('pdf:Keywords', metadata.keywords);
  simple('pdf:Producer', metadata.producer);
  simple('xmp:CreatorTool', metadata.creator);
  if (created) simple('xmp:CreateDate', created.toISOString());
  simple('xmp:ModifyDate', modified.toISOString());
  simple('xmp:MetadataDate', modified.toISOString());
  const bom = String.fromCharCode(0xfeff);
  return [
    `<?xpacket begin="${bom}" id="W5M0MpCehiHzreSzNTczkc9d"?>`,
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
    ' <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    '  <rdf:Description rdf:about=""',
    '    xmlns:dc="http://purl.org/dc/elements/1.1/"',
    '    xmlns:xmp="http://ns.adobe.com/xap/1.0/"',
    '    xmlns:pdf="http://ns.adobe.com/pdf/1.3/">',
    ...lines,
    '  </rdf:Description>',
    ' </rdf:RDF>',
    '</x:xmpmeta>',
    '<?xpacket end="w"?>',
  ].join('\n');
};

/**
 * Writes document metadata: the information dictionary (standard fields, Source and custom
 * properties), the catalog language and an XMP packet with the same values. Empty fields are
 * removed rather than left with pdf-lib's defaults.
 */
export const applyDocumentMetadata = (doc: PDFDocument, metadata: DocumentMetadata, now: Date = new Date()) => {
  const info = (doc as unknown as { getInfoDict(): PDFDict }).getInfoDict();
  const setText = (key: string, value?: string) => {
    if (value && value.trim()) info.set(PDFName.of(key), PDFHexString.fromText(value));
    else info.delete(PDFName.of(key));
  };
  setText('Title', metadata.title);
  setText('Author', metadata.author);
  setText('Subject', metadata.subject);
  setText('Keywords', metadata.keywords);
  setText('Creator', metadata.creator);
  setText('Producer', metadata.producer);
  setText('Source', metadata.source);

  const created = validDate(metadata.creationDate);
  if (created) doc.setCreationDate(created);
  const modified = metadata.autoModificationDate === false ? validDate(metadata.modificationDate) || now : now;
  doc.setModificationDate(modified);

  for (const { key, value } of metadata.customProperties || []) {
    const cleanKey = key.trim();
    if (!cleanKey || RESERVED_METADATA_KEYS.has(cleanKey)) continue;
    setText(cleanKey, value);
  }

  if (metadata.language && metadata.language.trim()) {
    doc.setLanguage(metadata.language.trim());
  } else {
    doc.catalog.delete(PDFName.of('Lang'));
  }

  const xmp = buildXmpPacket(metadata, created || doc.getCreationDate() || null, modified);
  const xmpStream = doc.context.stream(new TextEncoder().encode(xmp), {
    Type: 'Metadata',
    Subtype: 'XML',
  });
  doc.catalog.set(PDFName.of('Metadata'), doc.context.register(xmpStream));
};
