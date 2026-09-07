import { describe, it, expect } from 'vitest';
import { StreamSegment } from '../src/services/contentStreamEditor';

describe('Document Tree & Block Hierarchy Logic', () => {
  // Helper to build sections mimicking EditSidePanel
  interface DocumentSection {
    id: string;
    headingBlock?: StreamSegment;
    title: string;
    role: 'h1' | 'h2' | 'intro';
    children: StreamSegment[];
  }

  function buildDocumentSections(displayedBlocks: StreamSegment[]): DocumentSection[] {
    const sections: DocumentSection[] = [];
    let currentSec: DocumentSection | null = null;
    let secIndex = 1;

    for (const b of displayedBlocks) {
      if (b.headingRole === 'h1' || b.headingRole === 'h2') {
        currentSec = {
          id: `sec_${b.id}`,
          headingBlock: b,
          title: b.previewText,
          role: b.headingRole,
          children: [],
        };
        sections.push(currentSec);
        secIndex++;
      } else {
        if (!currentSec) {
          currentSec = {
            id: `sec_intro_${secIndex}`,
            title: 'Úvodní obsah / Záhlaví',
            role: 'intro',
            children: [],
          };
          sections.push(currentSec);
          secIndex++;
        }
        currentSec.children.push(b);
      }
    }
    return sections;
  }

  it('correctly creates an intro section for blocks preceding the first heading', () => {
    const blocks: StreamSegment[] = [
      {
        id: 'block_1',
        type: 'text',
        rawContent: '',
        previewText: 'Západočeská univerzita v Plzni',
        startIndex: 0,
        endIndex: 10,
        x: 50,
        y: 800,
      },
      {
        id: 'block_2',
        type: 'text',
        rawContent: '',
        previewText: 'Fakulta aplikovaných věd',
        startIndex: 11,
        endIndex: 20,
        x: 50,
        y: 785,
      },
      {
        id: 'block_3',
        type: 'text',
        rawContent: '',
        previewText: '1. Úvod do problematiky',
        headingRole: 'h1',
        startIndex: 21,
        endIndex: 30,
        x: 50,
        y: 740,
      },
      {
        id: 'block_4',
        type: 'text',
        rawContent: '',
        previewText: 'Tento dokument popisuje zadání.',
        startIndex: 31,
        endIndex: 40,
        x: 50,
        y: 720,
      },
    ];

    const sections = buildDocumentSections(blocks);
    expect(sections.length).toBe(2);

    // Section 1: Intro
    expect(sections[0].role).toBe('intro');
    expect(sections[0].title).toBe('Úvodní obsah / Záhlaví');
    expect(sections[0].children.length).toBe(2);
    expect(sections[0].children[0].id).toBe('block_1');
    expect(sections[0].children[1].id).toBe('block_2');

    // Section 2: H1 Section
    expect(sections[1].role).toBe('h1');
    expect(sections[1].headingBlock?.id).toBe('block_3');
    expect(sections[1].title).toBe('1. Úvod do problematiky');
    expect(sections[1].children.length).toBe(1);
    expect(sections[1].children[0].id).toBe('block_4');
  });

  it('groups multiple headings and subheadings into independent collapsible sections', () => {
    const blocks: StreamSegment[] = [
      {
        id: 'b1',
        type: 'text',
        rawContent: '',
        previewText: 'Kapitola 1',
        headingRole: 'h1',
        startIndex: 0,
        endIndex: 10,
      },
      {
        id: 'b2',
        type: 'text',
        rawContent: '',
        previewText: 'Text kapitoly 1...',
        startIndex: 11,
        endIndex: 20,
      },
      {
        id: 'b3',
        type: 'text',
        rawContent: '',
        previewText: 'Podkapitola 1.1',
        headingRole: 'h2',
        startIndex: 21,
        endIndex: 30,
      },
      {
        id: 'b4',
        type: 'text',
        rawContent: '',
        previewText: 'Detail podkapitoly...',
        startIndex: 31,
        endIndex: 40,
      },
      {
        id: 'b5',
        type: 'text',
        rawContent: '',
        previewText: 'Druhý odstavec podkapitoly...',
        startIndex: 41,
        endIndex: 50,
      },
    ];

    const sections = buildDocumentSections(blocks);
    expect(sections.length).toBe(2);

    expect(sections[0].headingBlock?.id).toBe('b1');
    expect(sections[0].children.length).toBe(1);
    expect(sections[0].children[0].id).toBe('b2');

    expect(sections[1].headingBlock?.id).toBe('b3');
    expect(sections[1].role).toBe('h2');
    expect(sections[1].children.length).toBe(2);
    expect(sections[1].children.map((c) => c.id)).toEqual(['b4', 'b5']);
  });
});
