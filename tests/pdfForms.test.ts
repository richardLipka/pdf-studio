import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { applyFormValuesToPdfDocument } from '../src/services/formService';
import { exportEditedPdf } from '../src/services/pdfExporter';
import { SourceDocument, PdfPageModel, DEFAULT_RASTERIZATION_SETTINGS } from '../src/types/document';

describe('PDF Forms Service & Export', () => {
  it('creates an AcroForm, fills text & checkboxes, and flattens successfully', async () => {
    // 1. Create a PDF with form fields using pdf-lib
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([600, 400]);
    const form = pdfDoc.getForm();

    const nameField = form.createTextField('applicant.name');
    nameField.setText('Jan Novák');
    nameField.addToPage(page, { x: 50, y: 300, width: 200, height: 25 });

    const emailField = form.createTextField('applicant.email');
    emailField.setText('jan@example.cz');
    emailField.addToPage(page, { x: 50, y: 250, width: 200, height: 25 });

    const agreeCheckbox = form.createCheckBox('terms.agreed');
    agreeCheckbox.addToPage(page, { x: 50, y: 200, width: 20, height: 20 });

    const dropdown = form.createDropdown('service.type');
    dropdown.addOptions(['Standard', 'Premium', 'VIP Expres']);
    dropdown.select('Standard');
    dropdown.addToPage(page, { x: 50, y: 150, width: 150, height: 25 });

    const pdfBytes = await pdfDoc.save();

    // 2. Load it as a source document
    const sourceDoc: SourceDocument = {
      id: 'src-form-1',
      name: 'form-test.pdf',
      arrayBuffer: pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength),
      updatedAt: Date.now(),
    };

    const pageModel: PdfPageModel = {
      id: 'p-1',
      sourceDocId: 'src-form-1',
      originalPageIndex: 0,
      width: 600,
      height: 400,
      rotation: 0,
      sourceType: 'pdf',
    };

    // 3. Update form values including full Czech characters with diacritics
    const filledValues = {
      'applicant.name': 'Příliš žluťoučký kůň - ĚŠČŘŽÝÁÍÉŮÚŤĎŇ',
      'applicant.email': 'lipka@fav.zcu.cz',
      'terms.agreed': true,
      'service.type': 'VIP Expres',
    };

    // 4. Test interactive export
    const interactiveBytes = await exportEditedPdf(
      [sourceDoc],
      [pageModel],
      [],
      'form-interactive.pdf',
      DEFAULT_RASTERIZATION_SETTINGS,
      undefined,
      filledValues,
      'interactive'
    );

    expect(interactiveBytes).toBeDefined();
    expect(interactiveBytes.length).toBeGreaterThan(0);

    // Verify filled values in exported interactive PDF
    const loadedInteractive = await PDFDocument.load(interactiveBytes);
    const loadedForm = loadedInteractive.getForm();
    expect(loadedForm.getTextField('applicant.name').getText()).toBe(
      'Příliš žluťoučký kůň - ĚŠČŘŽÝÁÍÉŮÚŤĎŇ'
    );
    expect(loadedForm.getTextField('applicant.email').getText()).toBe('lipka@fav.zcu.cz');
    expect(loadedForm.getCheckBox('terms.agreed').isChecked()).toBe(true);
    expect(loadedForm.getDropdown('service.type').getSelected()).toEqual(['VIP Expres']);

    // 5. Test flattened export
    const flattenedBytes = await exportEditedPdf(
      [sourceDoc],
      [pageModel],
      [],
      'form-flattened.pdf',
      DEFAULT_RASTERIZATION_SETTINGS,
      undefined,
      filledValues,
      'flatten'
    );

    expect(flattenedBytes).toBeDefined();
    expect(flattenedBytes.length).toBeGreaterThan(0);

    const loadedFlattened = await PDFDocument.load(flattenedBytes);
    const flattenedForm = loadedFlattened.getForm();
    // After flattening, form fields are converted to static vectors and form.getFields() is empty
    expect(flattenedForm.getFields().length).toBe(0);
  });

  it('handles empty and partial form values safely without throwing', async () => {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([500, 500]);
    const form = pdfDoc.getForm();
    const tf = form.createTextField('test.field');
    tf.addToPage(page, { x: 50, y: 100, width: 100, height: 20 });

    // Partial value
    applyFormValuesToPdfDocument(pdfDoc, { 'unknown.field': 'ignored', 'test.field': 'Val' }, false);
    expect(tf.getText()).toBe('Val');

    // Flattening without errors
    applyFormValuesToPdfDocument(pdfDoc, {}, true);
    expect(form.getFields().length).toBe(0);
  });

  it('correctly handles checkbox boolean truthy/falsy values', async () => {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([400, 300]);
    const form = pdfDoc.getForm();
    const cb1 = form.createCheckBox('check.1');
    const cb2 = form.createCheckBox('check.2');
    cb1.addToPage(page, { x: 50, y: 100, width: 20, height: 20 });
    cb2.addToPage(page, { x: 50, y: 150, width: 20, height: 20 });

    applyFormValuesToPdfDocument(
      pdfDoc,
      {
        'check.1': true,
        'check.2': false,
      },
      false
    );

    expect(cb1.isChecked()).toBe(true);
    expect(cb2.isChecked()).toBe(false);
  });
});
