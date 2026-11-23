import { describe, it, expect } from 'vitest';
import { inflateSync } from 'zlib';
import * as forge from 'node-forge';
import {
  PDFDocument,
  PDFName,
  PDFArray,
  PDFDict,
  PDFNull,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFString,
  StandardFonts,
  degrees,
  rgb,
  decodePDFRawStream,
  arrayAsString,
} from 'pdf-lib';
import { exportEditedPdf, applyDocumentMetadata } from '../src/services/pdfExporter';
import { extractFormFieldsFromPdf } from '../src/services/formService';
import {
  parsePkcs12,
  generateSelfSignedCertificate,
  signPdfWithCertificate,
} from '../src/services/digitalSignatureService';
import { parsePdfDate } from '../src/services/pdfLoader';
import { repairPdfDefects } from '../src/services/pdfRepair';
import {
  tokenizeContentStream,
  decodeLiteralStringBytes,
} from '../src/services/pdfContentTokenizer';
import {
  unescapePdfLiteralString,
  replaceTextInStreamString,
  replaceTextInPageContentStream,
  replaceImageOnPage,
  safeGetPageResources,
} from '../src/services/contentStreamEditor';
import { searchPdfDocument } from '../src/services/pdfSearchService';
import {
  PdfPageModel,
  SourceDocument,
  DEFAULT_RASTERIZATION_SETTINGS,
} from '../src/types/document';
import {
  HighlightAnnotation,
  ShapeAnnotation,
  TextAnnotation,
} from '../src/types/annotations';

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

const tinyPngBytes = (r: number, g: number, b: number): Uint8Array => {
  // Minimal 1x1 PNG helper using raw prebuilt 1x1 PNG buffers (red vs blue)
  const hexRed =
    '89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415408d763f8cfc000000301010018dd8db00000000049454e44ae426082';
  const hexBlue =
    '89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415408d7636060f80f0001040100109248a80000000049454e44ae426082';
  const hex = r >= b && g === 0 ? hexRed : hexBlue;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
};

describe('PDF Specification Compliance, Untouched-Page Invariants & Performance', () => {
  describe('Exporter PDFObjectCopier Reference Mapping & Untouched Pages (ISO 32000-1 §§ 12.3.2, 12.3.3, 12.5.6.5, 12.7.2)', () => {
    it('remaps /Outlines, internal /Link /Dest, and /Names /Dests to real output pages, excludes deleted pages, and leaves untouched pages intact', async () => {
      const srcDoc = await PDFDocument.create();
      const font = await srcDoc.embedFont(StandardFonts.Helvetica);

      const p0 = srcDoc.addPage([595, 842]);
      p0.drawText('Page Zero Untouched', { x: 50, y: 750, size: 14, font });

      const p1 = srcDoc.addPage([595, 842]);
      p1.drawText('Page One Secret Deleted', { x: 50, y: 750, size: 14, font });

      const p2 = srcDoc.addPage([595, 842]);
      p2.drawText('Page Two Target', { x: 50, y: 750, size: 14, font });

      // Internal /Link on page 0 pointing directly to page 2
      const linkDict = srcDoc.context.obj({
        Type: 'Annot',
        Subtype: 'Link',
        Rect: [50, 700, 200, 720],
        Dest: [p2.ref, PDFName.of('Fit')],
      });
      p0.node.set(PDFName.of('Annots'), srcDoc.context.obj([srcDoc.context.register(linkDict)]));

      // AcroForm fields: one on kept page 0, one on deleted page 1
      const form = srcDoc.getForm();
      const keepField = form.createTextField('keep_field');
      keepField.setText('Kept');
      keepField.addToPage(p0, { x: 50, y: 600, width: 150, height: 22 });

      const delField = form.createTextField('deleted_field');
      delField.setText('ShouldNotLeak');
      delField.addToPage(p1, { x: 50, y: 600, width: 150, height: 22 });

      // Document /Outlines pointing to p0, p1 (deleted), p2
      const outlinesRef = srcDoc.context.nextRef();
      const item0Ref = srcDoc.context.nextRef();
      const item1Ref = srcDoc.context.nextRef();
      const item2Ref = srcDoc.context.nextRef();
      srcDoc.context.assign(
        item0Ref,
        srcDoc.context.obj({
          Title: PDFString.of('Chapter 1'),
          Parent: outlinesRef,
          Next: item1Ref,
          Dest: [p0.ref, PDFName.of('Fit')],
        })
      );
      srcDoc.context.assign(
        item1Ref,
        srcDoc.context.obj({
          Title: PDFString.of('Deleted Chapter'),
          Parent: outlinesRef,
          Prev: item0Ref,
          Next: item2Ref,
          Dest: [p1.ref, PDFName.of('Fit')],
        })
      );
      srcDoc.context.assign(
        item2Ref,
        srcDoc.context.obj({
          Title: PDFString.of('Chapter 3'),
          Parent: outlinesRef,
          Prev: item1Ref,
          Dest: [p2.ref, PDFName.of('Fit')],
        })
      );
      srcDoc.context.assign(
        outlinesRef,
        srcDoc.context.obj({
          Type: 'Outlines',
          First: item0Ref,
          Last: item2Ref,
          Count: 3,
        })
      );
      srcDoc.catalog.set(PDFName.of('Outlines'), outlinesRef);

      // Named destination in Catalog /Names /Dests pointing to page 2
      const destsTree = srcDoc.context.obj({
        Names: [PDFString.of('GoPage2'), srcDoc.context.obj([p2.ref, PDFName.of('Fit')])],
      });
      srcDoc.catalog.set(
        PDFName.of('Names'),
        srcDoc.context.register(srcDoc.context.obj({ Dests: srcDoc.context.register(destsTree) }))
      );

      const srcBytes = await srcDoc.save();
      const sourceDoc: SourceDocument = {
        id: 'src-ref-map',
        name: 'ref-map.pdf',
        arrayBuffer: toArrayBuffer(srcBytes),
        updatedAt: Date.now(),
      };

      // Export keeping ONLY page 0 and page 2 (page 1 deleted)
      const keptModels: PdfPageModel[] = [
        {
          id: 'pm-0',
          sourceDocId: 'src-ref-map',
          originalPageIndex: 0,
          width: 595,
          height: 842,
          rotation: 0,
          sourceType: 'pdf',
        },
        {
          id: 'pm-2',
          sourceDocId: 'src-ref-map',
          originalPageIndex: 2,
          width: 595,
          height: 842,
          rotation: 0,
          sourceType: 'pdf',
        },
      ];

      const outBytes = await exportEditedPdf(
        [sourceDoc],
        keptModels,
        [],
        'out.pdf',
        DEFAULT_RASTERIZATION_SETTINGS,
        undefined,
        undefined,
        'interactive',
        false
      );

      const outDoc = await PDFDocument.load(outBytes);
      expect(outDoc.getPageCount()).toBe(2);
      const outP0 = outDoc.getPage(0);
      const outP1 = outDoc.getPage(1);

      // 1. Exactly 2 /Type /Page objects exist (no orphan duplicate pages!)
      let totalPageLeafObjects = 0;
      for (const [, obj] of outDoc.context.enumerateIndirectObjects()) {
        if (obj instanceof PDFDict && obj.lookup(PDFName.of('Type')) === PDFName.of('Page')) {
          totalPageLeafObjects++;
        }
      }
      expect(totalPageLeafObjects).toBe(2);

      // 2. Deleted page's content was never copied into outputDoc
      let leakedSecret = false;
      for (const [, obj] of outDoc.context.enumerateIndirectObjects()) {
        if (obj instanceof PDFRawStream) {
          try {
            const text = arrayAsString(decodePDFRawStream(obj).decode());
            if (text.includes('Page One Secret Deleted')) leakedSecret = true;
          } catch {
            // ignore non-flate streams
          }
        }
      }
      expect(leakedSecret).toBe(false);

      // 3. Internal /Link on page 0 points to the ACTUAL output page 1 (original page 2)
      const outAnnots = outDoc.context.lookup(outP0.node.get(PDFName.of('Annots'))) as PDFArray;
      let foundLinkDestRef: unknown = null;
      for (let i = 0; i < outAnnots.size(); i++) {
        const d = outDoc.context.lookup(outAnnots.get(i)) as PDFDict;
        if (d.lookup(PDFName.of('Subtype')) === PDFName.of('Link')) {
          const dest = d.lookup(PDFName.of('Dest')) as PDFArray;
          foundLinkDestRef = dest.get(0);
        }
      }
      expect(foundLinkDestRef).toBe(outP1.ref);

      // 4. Outlines point to actual output pages (and PDFNull for deleted page)
      const outOutlines = outDoc.catalog.lookup(PDFName.of('Outlines')) as PDFDict;
      const outItem0 = outDoc.context.lookup(outOutlines.get(PDFName.of('First'))) as PDFDict;
      const outItem1 = outDoc.context.lookup(outItem0.get(PDFName.of('Next'))) as PDFDict;
      const outItem2 = outDoc.context.lookup(outItem1.get(PDFName.of('Next'))) as PDFDict;
      expect((outItem0.lookup(PDFName.of('Dest')) as PDFArray).get(0)).toBe(outP0.ref);
      expect((outItem1.lookup(PDFName.of('Dest')) as PDFArray).get(0)).toBe(PDFNull);
      expect((outItem2.lookup(PDFName.of('Dest')) as PDFArray).get(0)).toBe(outP1.ref);

      // 5. Named destination /Names /Dests points to actual output page 1
      const outNames = outDoc.catalog.lookup(PDFName.of('Names')) as PDFDict;
      const outDests = outNames.lookup(PDFName.of('Dests')) as PDFDict;
      const namesArr = outDests.lookup(PDFName.of('Names')) as PDFArray;
      const destArr = outDoc.context.lookup(namesArr.get(1)) as PDFArray;
      expect(destArr.get(0)).toBe(outP1.ref);

      // 6. AcroForm retains keep_field and excludes deleted_field
      const outFieldNames = outDoc.getForm().getFields().map((f) => f.getName());
      expect(outFieldNames).toContain('keep_field');
      expect(outFieldNames).not.toContain('deleted_field');

      // 7. Untouched unrotated pages do not get spurious /Rotate keys injected
      expect(outP0.node.has(PDFName.of('Rotate'))).toBe(false);
      expect(outP1.node.has(PDFName.of('Rotate'))).toBe(false);
    });
  });

  describe('Annotation Appearance Streams, Indirect /Annots & ISO 32000-1 Attributes', () => {
    it('writes /ExtGState Multiply & alpha on Highlight/Circle, appends to indirect /Annots, and outputs spec-compliant borderless FreeText', async () => {
      // Source PDF with an INDIRECT /Annots array containing a structural /Link
      const srcDoc = await PDFDocument.create();
      const p = srcDoc.addPage([595, 842]);
      const linkRef = srcDoc.context.register(
        srcDoc.context.obj({
          Type: 'Annot',
          Subtype: 'Link',
          Rect: [10, 10, 100, 30],
          A: { Type: 'Action', S: 'URI', URI: PDFString.of('https://example.org') },
        })
      );
      const indirectAnnotsRef = srcDoc.context.register(srcDoc.context.obj([linkRef]));
      p.node.set(PDFName.of('Annots'), indirectAnnotsRef);

      const srcBytes = await srcDoc.save();
      const sourceDoc: SourceDocument = {
        id: 'src-ind-annots',
        name: 'indirect-annots.pdf',
        arrayBuffer: toArrayBuffer(srcBytes),
        updatedAt: Date.now(),
      };
      const pageModel: PdfPageModel = {
        id: 'p-ind',
        sourceDocId: 'src-ind-annots',
        originalPageIndex: 0,
        width: 595,
        height: 842,
        rotation: 0,
        sourceType: 'pdf',
      };

      const annotations = [
        {
          id: 'hl-multi',
          pageId: 'p-ind',
          type: 'highlight',
          x: 50,
          y: 100,
          width: 200,
          height: 36,
          rects: [
            { x: 50, y: 100, width: 200, height: 14 },
            { x: 50, y: 120, width: 120, height: 14 },
          ],
          color: '#fde047',
          opacity: 0.35,
          createdAt: 1,
          updatedAt: 1,
        } as HighlightAnnotation,
        {
          id: 'circle-tiny',
          pageId: 'p-ind',
          type: 'shape',
          shapeType: 'ellipse',
          x: 300,
          y: 200,
          width: 4,
          height: 4,
          strokeWidth: 10,
          color: '#10b981',
          fillColor: 'transparent',
          opacity: 0.5,
          createdAt: 1,
          updatedAt: 1,
        } as ShapeAnnotation,
        {
          id: 'ft-borderless',
          pageId: 'p-ind',
          type: 'text',
          x: 100,
          y: 300,
          width: 150,
          height: 30,
          color: '#1e293b',
          opacity: 1,
          text: 'Transparent FreeText',
          fontSize: 12,
          fontFamily: 'Inter',
          backgroundColor: 'transparent',
          borderWidth: 0,
          createdAt: 1,
          updatedAt: 1,
        } as TextAnnotation,
      ];

      const outBytes = await exportEditedPdf(
        [sourceDoc],
        [pageModel],
        annotations,
        'annots-spec.pdf',
        DEFAULT_RASTERIZATION_SETTINGS,
        undefined,
        undefined,
        'interactive',
        false
      );

      const outDoc = await PDFDocument.load(outBytes);
      const outPage = outDoc.getPage(0);
      const annots = outDoc.context.lookup(outPage.node.get(PDFName.of('Annots'))) as PDFArray;
      // 1 preserved /Link + 3 newly added annotations (none dropped despite indirect /Annots!)
      expect(annots.size()).toBe(4);

      const bySubtype = new Map<string, PDFDict>();
      for (let i = 0; i < annots.size(); i++) {
        const d = outDoc.context.lookup(annots.get(i)) as PDFDict;
        bySubtype.set(String(d.lookup(PDFName.of('Subtype'))), d);
      }

      // 1. Highlight has 2 quads (16 QuadPoints) and /ExtGState with /BM /Multiply and /ca 0.35
      const hl = bySubtype.get('/Highlight')!;
      expect((hl.lookup(PDFName.of('QuadPoints')) as PDFArray).size()).toBe(16);
      const hlAp = outDoc.context.lookup((hl.lookup(PDFName.of('AP')) as PDFDict).get(PDFName.of('N'))) as PDFRawStream;
      const hlOps = new TextDecoder('latin1').decode(inflateSync(Buffer.from(hlAp.contents)));
      expect(hlOps).toContain('/GS0 gs');
      const hlRes = hlAp.dict.lookup(PDFName.of('Resources')) as PDFDict;
      const hlGs0 = (hlRes.lookup(PDFName.of('ExtGState')) as PDFDict).lookup(PDFName.of('GS0')) as PDFDict;
      expect(hlGs0.lookup(PDFName.of('BM'))).toBe(PDFName.of('Multiply'));
      expect((hlGs0.lookup(PDFName.of('ca')) as PDFNumber).asNumber()).toBeCloseTo(0.35, 2);

      // 2. Tiny translucent Circle has /ExtGState /ca 0.5 and closed path (`h S`)
      const circle = bySubtype.get('/Circle')!;
      const cAp = outDoc.context.lookup((circle.lookup(PDFName.of('AP')) as PDFDict).get(PDFName.of('N'))) as PDFRawStream;
      const cOps = new TextDecoder('latin1').decode(inflateSync(Buffer.from(cAp.contents)));
      expect(cOps).toContain('/GS0 gs');
      expect(cOps).toContain(' h S Q');
      const cRes = cAp.dict.lookup(PDFName.of('Resources')) as PDFDict;
      const cGs0 = (cRes.lookup(PDFName.of('ExtGState')) as PDFDict).lookup(PDFName.of('GS0')) as PDFDict;
      expect((cGs0.lookup(PDFName.of('ca')) as PDFNumber).asNumber()).toBeCloseTo(0.5, 2);

      // 3. Borderless transparent FreeText has /C [], /Border [0 0 0], /BS /W 0
      const ft = bySubtype.get('/FreeText')!;
      expect((ft.lookup(PDFName.of('C')) as PDFArray).size()).toBe(0);
      const border = ft.lookup(PDFName.of('Border')) as PDFArray;
      expect(border.asArray().map((n) => (n as PDFNumber).asNumber())).toEqual([0, 0, 0]);
      const bs = ft.lookup(PDFName.of('BS')) as PDFDict;
      expect((bs.lookup(PDFName.of('W')) as PDFNumber).asNumber()).toBe(0);
    });
  });

  describe('AcroForm Extraction (pdf.js 6) & Visible Flattening', () => {
    it('extracts text, checkbox, radio group (unique IDs + exportValues), dropdown, and optionList with valid CSS hex color, and burns filled values when flattening', async () => {
      const pdfDoc = await PDFDocument.create();
      const page = pdfDoc.addPage([600, 400]);
      const form = pdfDoc.getForm();

      const tf = form.createTextField('user.name');
      tf.setText('Initial');
      tf.addToPage(page, { x: 40, y: 320, width: 180, height: 24 });

      const cb = form.createCheckBox('user.agree');
      cb.addToPage(page, { x: 40, y: 280, width: 18, height: 18 });

      const rg = form.createRadioGroup('user.plan');
      rg.addOptionToPage('Basic', page, { x: 40, y: 240, width: 16, height: 16 });
      rg.addOptionToPage('Pro', page, { x: 100, y: 240, width: 16, height: 16 });
      rg.select('Basic');

      const dd = form.createDropdown('user.country');
      dd.addOptions(['CZ', 'SK', 'DE']);
      dd.select('CZ');
      dd.addToPage(page, { x: 40, y: 190, width: 120, height: 24 });

      const ol = form.createOptionList('user.tags');
      ol.addOptions(['Alpha', 'Beta', 'Gamma']);
      ol.select('Alpha');
      ol.addToPage(page, { x: 40, y: 100, width: 120, height: 60 });

      const bytes = await pdfDoc.save();
      const buf = toArrayBuffer(bytes);
      const pageModel: PdfPageModel = {
        id: 'fp-1',
        sourceDocId: 'src-form-extract',
        originalPageIndex: 0,
        width: 600,
        height: 400,
        rotation: 0,
        sourceType: 'pdf',
      };

      const extracted = await extractFormFieldsFromPdf(buf, 'src-form-extract', [pageModel]);
      expect(extracted.length).toBeGreaterThanOrEqual(6);

      // Unique IDs across radio widgets of the same field name on the same page
      const ids = extracted.map((f) => f.id);
      expect(new Set(ids).size).toBe(ids.length);

      const radios = extracted.filter((f) => f.type === 'radio' && f.name === 'user.plan');
      expect(radios.length).toBe(2);
      expect(radios.map((r) => r.exportValue).sort()).toEqual(['Basic', 'Pro']);

      const optionListField = extracted.find((f) => f.name === 'user.tags');
      expect(optionListField?.type).toBe('optionList');

      // Font colors must be valid CSS #rrggbb (never "#0,0,0")
      for (const f of extracted) {
        if (f.color) {
          expect(f.color).toMatch(/^#[0-9a-fA-F]{6}$/);
        }
      }

      // Flattening must burn the NEW filled value into the page streams (not leave stale "Initial")
      const sourceDoc: SourceDocument = {
        id: 'src-form-extract',
        name: 'form.pdf',
        arrayBuffer: buf,
        updatedAt: Date.now(),
      };
      const flattenedBytes = await exportEditedPdf(
        [sourceDoc],
        [pageModel],
        [],
        'flattened.pdf',
        DEFAULT_RASTERIZATION_SETTINGS,
        undefined,
        {
          'user.name': 'Updated Name 2026',
          'user.agree': true,
          'user.plan': 'Pro',
          'user.country': 'DE',
        },
        'flatten',
        false
      );

      const flatDoc = await PDFDocument.load(flattenedBytes);
      expect(flatDoc.getForm().getFields().length).toBe(0);

      // Verify via pdf.js text extraction that the burned-in flattened page renders the new value
      const flatBuf = toArrayBuffer(flattenedBytes);
      const flatMatches = await searchPdfDocument(
        [{ ...pageModel, id: 'fp-flat', sourceDocId: 'src-form-flat' }],
        [{ id: 'src-form-flat', name: 'flattened.pdf', arrayBuffer: flatBuf, updatedAt: Date.now() }],
        'Updated Name 2026'
      );
      expect(flatMatches.length).toBeGreaterThan(0);
    });
  });

  describe('Digital Signatures (PKCS#12 Leaf Matching, RFC 5280 ASN.1 Types & PAdES Widget)', () => {
    it('matches the private key to the leaf certificate even when a CA cert appears first in .p12', () => {
      const caKeys = forge.pki.rsa.generateKeyPair({ bits: 1024 });
      const caCert = forge.pki.createCertificate();
      caCert.publicKey = caKeys.publicKey;
      caCert.serialNumber = '01';
      caCert.validity.notBefore = new Date(Date.now() - 3600_000);
      caCert.validity.notAfter = new Date(Date.now() + 86400_000);
      caCert.setSubject([{ name: 'commonName', value: 'Root CA' }]);
      caCert.setIssuer([{ name: 'commonName', value: 'Root CA' }]);
      caCert.setExtensions([{ name: 'basicConstraints', cA: true }]);
      caCert.sign(caKeys.privateKey, forge.md.sha256.create());

      const leafKeys = forge.pki.rsa.generateKeyPair({ bits: 1024 });
      const leafCert = forge.pki.createCertificate();
      leafCert.publicKey = leafKeys.publicKey;
      leafCert.serialNumber = '02';
      leafCert.validity.notBefore = new Date(Date.now() - 3600_000);
      leafCert.validity.notAfter = new Date(Date.now() + 86400_000);
      leafCert.setSubject([{ name: 'commonName', value: 'Leaf Signer' }]);
      leafCert.setIssuer([{ name: 'commonName', value: 'Root CA' }]);
      leafCert.setExtensions([{ name: 'basicConstraints', cA: false }]);
      leafCert.sign(caKeys.privateKey, forge.md.sha256.create());

      // Intentionally place CA cert BEFORE leaf cert in the PKCS#12 bag
      const p12Asn1 = forge.pkcs12.toPkcs12Asn1(leafKeys.privateKey, [caCert, leafCert], 'secret', {
        generateLocalKeyId: true,
      });
      const derStr = forge.asn1.toDer(p12Asn1).getBytes();
      const u8 = new Uint8Array(derStr.length);
      for (let i = 0; i < derStr.length; i++) u8[i] = derStr.charCodeAt(i);

      const parsed = parsePkcs12(u8.buffer, 'secret');
      expect(parsed.certInfo.commonName).toBe('Leaf Signer');
      expect(parsed.certInfo.keyAlgorithm).toBe('RSA-1024');
      expect(parsed.certificateChain.length).toBe(2);
      expect(parsed.certificateChain[0]).toBe(parsed.certificatePem);
    });

    it('generates RFC 5280 compliant ASN.1 attribute types and compressed PAdES visual signatures', async () => {
      const gen = await generateSelfSignedCertificate({
        commonName: 'Jan Novák',
        organization: 'Test s.r.o.',
        country: 'CZ',
        email: 'jan@example.cz',
        password: 'pw',
      });

      const cert = forge.pki.certificateFromPem(gen.certificatePem);
      const countryAttr = cert.subject.attributes.find((a) => a.name === 'countryName');
      const emailAttr = cert.subject.attributes.find((a) => a.name === 'emailAddress');
      expect(countryAttr?.valueTagClass).toBe(forge.asn1.Type.PRINTABLESTRING);
      expect(emailAttr?.valueTagClass).toBe(forge.asn1.Type.IA5STRING);
      expect(gen.certInfo.keyAlgorithm).toBe('RSA-2048');

      // Sign a PDF that already has SigFlags = 4 to verify bitwise-OR preservation (4 | 3 = 7)
      const doc = await PDFDocument.create();
      doc.addPage([595, 842]);
      doc.catalog.set(
        PDFName.of('AcroForm'),
        doc.context.register(doc.context.obj({ Fields: [], SigFlags: 4 }))
      );
      const raw = await doc.save();

      const signed = await signPdfWithCertificate(toArrayBuffer(raw), gen.privateKeyPem, gen.certificatePem, {
        visualAppearance: true,
        reason: 'Approval',
      });
      const signedDoc = await PDFDocument.load(signed.signedPdfBytes);
      const acro = signedDoc.catalog.lookup(PDFName.of('AcroForm')) as PDFDict;
      expect((acro.lookup(PDFName.of('SigFlags')) as PDFNumber).asNumber()).toBe(7);

      const pageAnnots = signedDoc.context.lookup(signedDoc.getPage(0).node.get(PDFName.of('Annots'))) as PDFArray;
      const sigWidget = signedDoc.context.lookup(pageAnnots.get(0)) as PDFDict;
      expect((sigWidget.lookup(PDFName.of('F')) as PDFNumber).asNumber()).toBe(132);
      const apN = signedDoc.context.lookup((sigWidget.lookup(PDFName.of('AP')) as PDFDict).get(PDFName.of('N'))) as PDFRawStream;
      expect((apN.dict.lookup(PDFName.of('FormType')) as PDFNumber).asNumber()).toBe(1);
      expect(apN.dict.lookup(PDFName.of('Filter'))).toBe(PDFName.of('FlateDecode'));
    });
  });

  describe('PDF Dates, Metadata /Lang Clearing & CCITT /Rows 0 Repair', () => {
    it('parses ISO 32000-1 §7.9.4 PDF dates with positive/negative timezone offsets and partial dates', () => {
      expect(parsePdfDate("D:20240615143000+02'00'")).toBe('2024-06-15T12:30:00.000Z');
      expect(parsePdfDate("D:20240615083000-05'00'")).toBe('2024-06-15T13:30:00.000Z');
      expect(parsePdfDate('D:20240315Z')).toBe('2024-03-15T00:00:00.000Z');
      expect(parsePdfDate('D:2024')).toBe('2024-01-01T00:00:00.000Z');
    });

    it('removes /Lang from document catalog when metadata.language is cleared', async () => {
      const doc = await PDFDocument.create();
      doc.addPage([400, 400]);
      doc.setLanguage('cs-CZ');
      expect(doc.catalog.has(PDFName.of('Lang'))).toBe(true);

      applyDocumentMetadata(doc, {
        title: 'Test',
        author: '',
        subject: '',
        keywords: '',
        creator: '',
        producer: '',
        language: '',
      });
      expect(doc.catalog.has(PDFName.of('Lang'))).toBe(false);
    });

    it('leaves valid ISO 32000-1 Table 11 CCITT /Rows 0 images untouched (same ArrayBuffer reference)', async () => {
      const doc = await PDFDocument.create();
      const page = doc.addPage([100, 100]);
      const imgStream = doc.context.stream(new Uint8Array([0x00, 0x01]), {
        Type: 'XObject',
        Subtype: 'Image',
        Width: 8,
        Height: 2,
        BitsPerComponent: 1,
        ColorSpace: 'DeviceGray',
        Filter: 'CCITTFaxDecode',
        DecodeParms: { K: -1, Columns: 8, Rows: 0 },
      });
      page.node.set(
        PDFName.of('Resources'),
        doc.context.obj({ XObject: { Im0: doc.context.register(imgStream) } })
      );
      const bytes = await doc.save();
      const buf = toArrayBuffer(bytes);

      const repaired = await repairPdfDefects(buf);
      expect(repaired.repairs).toEqual([]);
      expect(repaired.buffer).toBe(buf);
    });
  });

  describe('Tokenizer, Escaping, Stream Replacement & Shared Resource Isolation', () => {
    it('handles % comments inside arrays/dicts and normalizes unescaped CR/CRLF in literal strings', () => {
      const stream = `[ (Hello) % comment with ] inside\n -100 (World) ] TJ << /Key % >> comment\n (Val) >> BDC EMC`;
      const ops = tokenizeContentStream(stream);
      expect(ops.map((o) => o.operator)).toEqual(['TJ', 'BDC', 'EMC']);
      expect(ops[0].operands[0].type).toBe('array');
      expect(ops[1].operands[0].type).toBe('dict');

      // ISO 32000-1 §7.3.4.2: unescaped \r\n and \r become 0x0A; escaped \r remains 0x0D
      expect(decodeLiteralStringBytes('(A\r\nB\rC\\rD)')).toEqual([
        0x41, 0x0a, 0x42, 0x0a, 0x43, 0x0d, 0x44,
      ]);
    });

    it('unescapes PDF literal strings in a single pass without corrupting escaped backslashes', () => {
      expect(unescapePdfLiteralString('\\\\n')).toBe('\\n');
      expect(unescapePdfLiteralString('\\\\101')).toBe('\\101');
      expect(unescapePdfLiteralString('\\\\(')).toBe('\\(');
      expect(unescapePdfLiteralString('Line1\\\nLine2')).toBe('Line1Line2');
      expect(unescapePdfLiteralString('Line1\\\r\nLine2')).toBe('Line1Line2');
    });

    it('replaces text safely in streams with ] inside TJ, balanced parens, $& replacements, and <hex> inside literal strings', () => {
      const stream = 'BT [(Item [1] old)] TJ (Keep (old) and <6f6c64>) Tj ET';
      const { modifiedContent, count } = replaceTextInStreamString(stream, 'old', '$&new');
      expect(count).toBe(2);
      expect(modifiedContent).toContain('[ (Item [1] $&new) ] TJ');
      // `<6f6c64>` inside the literal string was NOT corrupted into hex replacement!
      expect(modifiedContent).toContain('(Keep \\($&new\\) and <6f6c64>) Tj');
    });

    it('replaces text when /Contents is an indirect PDFRef pointing to a PDFArray', async () => {
      const doc = await PDFDocument.create();
      const font = await doc.embedFont(StandardFonts.Helvetica);
      const p0 = doc.addPage([400, 300]);
      const p1 = doc.addPage([400, 300]);
      p0.drawText('Original Indirect Target', { x: 20, y: 200, size: 12, font });
      p1.drawText('Untouched Page Text', { x: 20, y: 200, size: 12, font });

      // Flush page streams first, then store page 0's /Contents as an INDIRECT PDFArray (ISO 32000-1 Table 30)
      await doc.flush();
      const origContents = p0.node.get(PDFName.of('Contents'));
      expect(origContents).toBeDefined();
      const contentsArr =
        origContents instanceof PDFArray ? origContents : doc.context.obj([origContents!]);
      const indirectArrRef = doc.context.register(contentsArr);
      p0.node.set(PDFName.of('Contents'), indirectArrRef);

      const bytes = await doc.save();
      const res = await replaceTextInPageContentStream(
        toArrayBuffer(bytes),
        0,
        'Original',
        'Modified'
      );
      expect(res.error).toBeUndefined();
      expect(res.occurrencesReplaced).toBe(1);
      expect(res.pagesModified).toEqual([0]);

      const reloaded = await PDFDocument.load(res.updatedPdfBytes);
      const p0Contents = reloaded.context.lookup(reloaded.getPage(0).node.get(PDFName.of('Contents'))) as PDFArray;
      let combined0 = '';
      for (let i = 0; i < p0Contents.size(); i++) {
        const s = reloaded.context.lookup(p0Contents.get(i)) as PDFRawStream;
        combined0 += arrayAsString(decodePDFRawStream(s).decode());
      }
      expect(combined0).toContain('4d6f646966696564'); // "Modified" in hex (pdf-lib encodes standard text in hex)
    });

    it('isolates replaceImageOnPage when multiple pages share the same /Resources and /XObject dictionaries', async () => {
      const doc = await PDFDocument.create();
      const redImg = await doc.embedPng(tinyPngBytes(255, 0, 0));
      const p0 = doc.addPage([200, 200]);
      const p1 = doc.addPage([200, 200]);

      // Both pages share the EXACT SAME indirect /Resources & /XObject dicts
      const sharedXObjRef = doc.context.register(doc.context.obj({ ImShared: redImg.ref }));
      const sharedResRef = doc.context.register(doc.context.obj({ XObject: sharedXObjRef }));
      p0.node.set(PDFName.of('Resources'), sharedResRef);
      p1.node.set(PDFName.of('Resources'), sharedResRef);
      const paint = doc.context.register(doc.context.flateStream('q 100 0 0 100 0 0 cm /ImShared Do Q'));
      p0.node.set(PDFName.of('Contents'), paint);
      p1.node.set(PDFName.of('Contents'), paint);

      const origBytes = await doc.save();
      const beforeDoc = await PDFDocument.load(origBytes);
      const origImgRef0 = (safeGetPageResources(beforeDoc.getPage(0).node)!.lookup(PDFName.of('XObject')) as PDFDict).get(PDFName.of('ImShared'));
      const origImgRef1 = (safeGetPageResources(beforeDoc.getPage(1).node)!.lookup(PDFName.of('XObject')) as PDFDict).get(PDFName.of('ImShared'));
      expect(origImgRef0).toBe(origImgRef1);

      const replaced = await replaceImageOnPage(
        toArrayBuffer(origBytes),
        0,
        'ImShared',
        tinyPngBytes(0, 0, 255),
        'image/png'
      );
      expect(replaced.error).toBeUndefined();

      const afterDoc = await PDFDocument.load(replaced.updatedPdfBytes);
      const ref0 = (safeGetPageResources(afterDoc.getPage(0).node)!.lookup(PDFName.of('XObject')) as PDFDict).get(PDFName.of('ImShared'));
      const ref1 = (safeGetPageResources(afterDoc.getPage(1).node)!.lookup(PDFName.of('XObject')) as PDFDict).get(PDFName.of('ImShared'));
      expect(ref0).not.toBe(ref1);
    });
  });

  describe('Search Geometry for Rotated Text & AbortSignal Cancellation', () => {
    it('computes vertical bounding boxes for 90-degree rotated text and honours AbortSignal', async () => {
      const doc = await PDFDocument.create();
      const font = await doc.embedFont(StandardFonts.Helvetica);
      const page = doc.addPage([400, 400]);
      page.drawText('VERTICALWORD', {
        x: 200,
        y: 80,
        size: 14,
        font,
        color: rgb(0, 0, 0),
        rotate: degrees(90),
      });

      const bytes = await doc.save();
      const sourceDoc: SourceDocument = {
        id: 'src-rot-search',
        name: 'rot-search.pdf',
        arrayBuffer: toArrayBuffer(bytes),
        updatedAt: Date.now(),
      };
      const pages: PdfPageModel[] = [
        {
          id: 'rot-p1',
          sourceDocId: 'src-rot-search',
          originalPageIndex: 0,
          width: 400,
          height: 400,
          rotation: 0,
          sourceType: 'pdf',
        },
      ];

      const matches = await searchPdfDocument(pages, [sourceDoc], 'VERTICALWORD');
      expect(matches.length).toBe(1);
      expect(matches[0].rects.length).toBeGreaterThan(0);
      const rect = matches[0].rects[0];
      // Rotated 90° text runs vertically, so height must be significantly larger than width
      expect(rect.height).toBeGreaterThan(rect.width * 2);

      // Aborted signal returns immediately with empty results
      const controller = new AbortController();
      controller.abort();
      const abortedMatches = await searchPdfDocument(pages, [sourceDoc], 'VERTICALWORD', {
        signal: controller.signal,
      });
      expect(abortedMatches).toEqual([]);
    });
  });
});
