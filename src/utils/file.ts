import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

export const readFileAsArrayBuffer = (file: File): Promise<ArrayBuffer> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to read file as ArrayBuffer'));
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
};

export const readFileAsDataUrl = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to read file as DataURL'));
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
};

export const getImageDimensions = (
  dataUrl: string
): Promise<{ width: number; height: number }> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height });
    };
    img.onerror = () => reject(new Error('Failed to load image for dimensions'));
    img.src = dataUrl;
  });
};

/**
 * Remove light background from signature scan using alpha thresholding
 */
export const cleanSignatureBackground = (
  imgDataUrl: string,
  threshold: number = 210
): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(imgDataUrl);
        return;
      }

      ctx.drawImage(img, 0, 0);
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imgData.data;

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const brightness = 0.299 * r + 0.587 * g + 0.114 * b;

        if (brightness > threshold) {
          // Fade out background to full transparency
          const alphaFade = Math.max(0, 255 - (brightness - threshold) * 8);
          data[i + 3] = Math.min(data[i + 3], alphaFade);
        } else {
          // Boost dark ink contrast
          const contrastFactor = 1.3;
          data[i] = Math.max(0, Math.min(255, (r - 128) * contrastFactor + 128));
          data[i + 1] = Math.max(0, Math.min(255, (g - 128) * contrastFactor + 128));
          data[i + 2] = Math.max(0, Math.min(255, (b - 128) * contrastFactor + 128));
        }
      }

      ctx.putImageData(imgData, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => resolve(imgDataUrl);
    img.src = imgDataUrl;
  });
};

/**
 * Generate an attractive sample 2-page PDF document for immediate testing
 */
export const createSamplePdfDoc = async (lang: 'cs' | 'en' = 'cs'): Promise<ArrayBuffer> => {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Page 1 - Contract / Document Review
  const page1 = pdfDoc.addPage([595.28, 841.89]); // A4
  const { width, height } = page1.getSize();

  // Header Banner
  page1.drawRectangle({
    x: 0,
    y: height - 90,
    width: width,
    height: 90,
    color: rgb(0.02, 0.45, 0.8),
  });

  const titleText = lang === 'cs' ? 'DOHODA O SPOLUPRÁCI A DŮVĚRNOSTI' : 'COOPERATION & NON-DISCLOSURE AGREEMENT';
  const subtitleText = lang === 'cs' ? 'Vzorový dokument k revizi, anotaci a podpisu' : 'Sample document for review, annotations and digital signing';

  page1.drawText(titleText, {
    x: 40,
    y: height - 50,
    size: 16,
    font: fontBold,
    color: rgb(1, 1, 1),
  });

  page1.drawText(subtitleText, {
    x: 40,
    y: height - 72,
    size: 11,
    font: font,
    color: rgb(0.9, 0.95, 1),
  });

  // Paragraphs
  const p1Header = lang === 'cs' ? '1. Předmět a účel dohody' : '1. Subject and Purpose of Agreement';
  const p1Content = lang === 'cs'
    ? 'Tato dohoda upravuje vzájemná práva a povinnosti smluvních stran při vývoji webového editoru. Veškeré úpravy dokumentů probíhají plně v prohlížeči uživatele s důrazem na maximální ochranu osobních údajů.'
    : 'This agreement governs the mutual rights and obligations of the contracting parties in web editor development. All document processing takes place entirely in user browser with zero server uploads.';

  page1.drawText(p1Header, {
    x: 40,
    y: height - 130,
    size: 13,
    font: fontBold,
    color: rgb(0.1, 0.15, 0.2),
  });

  page1.drawText(p1Content, {
    x: 40,
    y: height - 155,
    size: 10,
    font: font,
    color: rgb(0.2, 0.25, 0.3),
    maxWidth: 515,
    lineHeight: 15,
  });

  // Section 2
  const p2Header = lang === 'cs' ? '2. Nástroje a funkce k otestování' : '2. Key Features to Test';
  page1.drawText(p2Header, {
    x: 40,
    y: height - 230,
    size: 13,
    font: fontBold,
    color: rgb(0.1, 0.15, 0.2),
  });

  const bulletPoints = lang === 'cs'
    ? [
        '• Zvýraznění (Highlight) - vyberte text a zvýrazněte klíčové informace žlutou barvou.',
        '• Přeškrtnutí (Strikethrough) - přeškrtněte zastaralé odstavce v rámci revize.',
        '• Podtržení (Underline) - podtrhněte termíny plnění nebo důležitá data.',
        '• Vložení poznámky (Sticky Note) - přidejte připomínku pro druhou smluvní stranu.',
        '• Digitální podpis - vložte svůj podpis v sekci Podpis dole na stránce.',
        '• Správa stránek v levém panelu - otočte nebo přeřaďte stránky přetažením myší.'
      ]
    : [
        '• Highlight - mark key clauses and information with translucent color.',
        '• Strikethrough - cross out outdated text during your document review.',
        '• Underline - underline critical deadlines or terms.',
        '• Sticky Notes - attach editable review comments for colleagues.',
        '• Digital Signature - draw, type or upload your signature at the bottom.',
        '• Page Management - rotate, delete, or reorder pages in the left sidebar.'
      ];

  let currentY = height - 260;
  for (const bp of bulletPoints) {
    page1.drawText(bp, {
      x: 50,
      y: currentY,
      size: 10,
      font: font,
      color: rgb(0.25, 0.3, 0.35),
      maxWidth: 500,
      lineHeight: 14,
    });
    currentY -= 28;
  }

  // Signature Boxes
  const sigY = 140;
  page1.drawRectangle({
    x: 40,
    y: sigY,
    width: 230,
    height: 90,
    borderColor: rgb(0.7, 0.75, 0.8),
    borderWidth: 1,
    color: rgb(0.98, 0.98, 0.99),
  });

  page1.drawRectangle({
    x: 320,
    y: sigY,
    width: 230,
    height: 90,
    borderColor: rgb(0.7, 0.75, 0.8),
    borderWidth: 1,
    color: rgb(0.98, 0.98, 0.99),
  });

  page1.drawText(lang === 'cs' ? 'Objednatel / Party A:' : 'Client / Party A:', {
    x: 50,
    y: sigY + 70,
    size: 10,
    font: fontBold,
    color: rgb(0.3, 0.35, 0.4),
  });

  page1.drawText(lang === 'cs' ? 'Zde vložte podpis 1' : 'Place Signature 1 here', {
    x: 50,
    y: sigY + 20,
    size: 9,
    font: font,
    color: rgb(0.6, 0.65, 0.7),
  });

  page1.drawText(lang === 'cs' ? 'Dodavatel / Party B:' : 'Provider / Party B:', {
    x: 330,
    y: sigY + 70,
    size: 10,
    font: fontBold,
    color: rgb(0.3, 0.35, 0.4),
  });

  page1.drawText(lang === 'cs' ? 'Zde vložte podpis 2' : 'Place Signature 2 here', {
    x: 330,
    y: sigY + 20,
    size: 9,
    font: font,
    color: rgb(0.6, 0.65, 0.7),
  });

  // Footer
  page1.drawText(lang === 'cs' ? 'Strana 1 z 2 • PDF Studio' : 'Page 1 of 2 • PDF Studio', {
    x: 40,
    y: 30,
    size: 9,
    font: font,
    color: rgb(0.5, 0.55, 0.6),
  });

  // Page 2 - Technical Specs
  const page2 = pdfDoc.addPage([595.28, 841.89]);
  page2.drawRectangle({
    x: 0,
    y: height - 70,
    width: width,
    height: 70,
    color: rgb(0.1, 0.15, 0.2),
  });

  page2.drawText(lang === 'cs' ? 'PŘÍLOHA Č. 1 - TECHNICKÁ SPECIFIKACE' : 'ANNEX NO. 1 - TECHNICAL SPECIFICATION', {
    x: 40,
    y: height - 42,
    size: 14,
    font: fontBold,
    color: rgb(1, 1, 1),
  });

  const p2Body = lang === 'cs'
    ? 'Tato druhá strana demonstruje vícesetové PDF dokumenty a správu stránek. Můžete ji otočit v levém panelu o 90 stupňů nebo smazat.'
    : 'This second page demonstrates multi-page documents and page operations. You can rotate it by 90 degrees or delete it in the left thumbnail panel.';

  page2.drawText(p2Body, {
    x: 40,
    y: height - 120,
    size: 11,
    font: font,
    color: rgb(0.2, 0.25, 0.3),
    maxWidth: 515,
    lineHeight: 16,
  });

  page2.drawText(lang === 'cs' ? 'Strana 2 z 2 • PDF Studio' : 'Page 2 of 2 • PDF Studio', {
    x: 40,
    y: 30,
    size: 9,
    font: font,
    color: rgb(0.5, 0.55, 0.6),
  });

  const pdfBytes = await pdfDoc.save();
  return pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength) as ArrayBuffer;
};
