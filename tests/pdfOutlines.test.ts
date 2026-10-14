import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getDocumentOutlines } from '../src/services/pdfLoader';
import { SourceDocument } from '../src/types/document';

describe('Document Outlines (Bookmarks / Table of Contents) Service', () => {
  const testFilesDir = path.resolve(__dirname, '../src/assets/testfiles');
  const specPath = path.join(testFilesDir, 'spec.pdf');
  const noOutlinePath = path.join(testFilesDir, 'A-D-edited.pdf');

  it('correctly extracts and resolves hierarchical outlines from a PDF document with bookmarks (spec.pdf)', async () => {
    if (!fs.existsSync(specPath)) {
      console.warn('spec.pdf not found, skipping outline extraction test');
      return;
    }

    const buffer = fs.readFileSync(specPath);
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

    const sourceDoc: SourceDocument = {
      id: 'spec_outline_test',
      name: 'spec.pdf',
      arrayBuffer,
      updatedAt: Date.now(),
    };

    const outlines = await getDocumentOutlines(sourceDoc);
    expect(Array.isArray(outlines)).toBe(true);
    expect(outlines.length).toBeGreaterThan(0);

    // Verify top-level structure
    const firstItem = outlines[0];
    expect(firstItem).toBeDefined();
    expect(typeof firstItem.title).toBe('string');
    expect(firstItem.title.length).toBeGreaterThan(0);
    expect(typeof firstItem.id).toBe('string');
    expect(Array.isArray(firstItem.items)).toBe(true);

    // Verify page index resolution
    // At least some outline items should have a valid 0-based pageIndex
    const allPageIndices: number[] = [];
    const collectIndices = (items: typeof outlines) => {
      for (const item of items) {
        if (item.pageIndex !== null && typeof item.pageIndex === 'number') {
          allPageIndices.push(item.pageIndex);
        }
        if (item.items && item.items.length > 0) {
          collectIndices(item.items);
        }
      }
    };
    collectIndices(outlines);

    expect(allPageIndices.length).toBeGreaterThan(0);
    for (const idx of allPageIndices) {
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(756); // spec.pdf has 756 pages
    }

    // Verify caching: calling again returns the cached promise
    const cachedOutlines = await getDocumentOutlines(sourceDoc);
    expect(cachedOutlines).toBe(outlines);
  }, 30000);

  it('returns an empty array gracefully for documents without outlines', async () => {
    if (!fs.existsSync(noOutlinePath)) {
      return;
    }

    const buffer = fs.readFileSync(noOutlinePath);
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

    const sourceDoc: SourceDocument = {
      id: 'no_outline_test',
      name: 'A-D-edited.pdf',
      arrayBuffer,
      updatedAt: Date.now(),
    };

    const outlines = await getDocumentOutlines(sourceDoc);
    expect(Array.isArray(outlines)).toBe(true);
    expect(outlines.length).toBe(0);
  });

  it('returns empty array when sourceDoc has invalid or empty arrayBuffer', async () => {
    const emptyDoc: SourceDocument = {
      id: 'empty_doc',
      name: 'empty.pdf',
      arrayBuffer: new ArrayBuffer(0),
    };

    const outlines = await getDocumentOutlines(emptyDoc);
    expect(outlines).toEqual([]);
  });
});
