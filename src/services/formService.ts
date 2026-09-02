import {
  PDFDocument,
  PDFTextField,
  PDFCheckBox,
  PDFRadioGroup,
  PDFDropdown,
  PDFOptionList,
  PDFName,
  PDFBool,
} from 'pdf-lib';
import { FormFieldModel, FormFieldType, FormFieldOption } from '../types/form';
import { PdfPageModel } from '../types/document';
import { getCachedPdfDocument } from './pdfLoader';
import { logger } from './logger';

/**
 * Extracts all interactive AcroForm fields from a PDF document using pdfjs-dist
 */
export const extractFormFieldsFromPdf = async (
  arrayBuffer: ArrayBuffer,
  sourceDocId: string,
  pages: PdfPageModel[]
): Promise<FormFieldModel[]> => {
  try {
    const pdfDoc = await getCachedPdfDocument(sourceDocId, arrayBuffer);
    const formFields: FormFieldModel[] = [];

    for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
      const pageModel = pages[pageIdx];
      if (pageModel.sourceType !== 'pdf') continue;

      let annotations: any[] = [];
      try {
        const pdfPage = await pdfDoc.getPage(pageModel.originalPageIndex + 1);
        annotations = await pdfPage.getAnnotations({ intent: 'display' });
      } catch (err) {
        logger.warn('load', `Nepodařilo se načíst formulářová pole ze strany ${pageIdx + 1}: ${err}`);
        continue;
      }

      // Filter for Widget annotations (AcroForm form fields)
      const widgets = annotations.filter(
        (ann) => ann.subtype === 'Widget' || ann.annotationType === 19 // 19 = AnnotationType.WIDGET
      );

      for (const widget of widgets) {
        if (!widget.rect || widget.rect.length < 4) continue;

        const [x1, y1, x2, y2] = widget.rect;
        const pageHeight = pageModel.height;
        const x = Math.min(x1, x2);
        const y = Math.min(pageHeight - y1, pageHeight - y2);
        const width = Math.max(12, Math.abs(x2 - x1));
        const height = Math.max(12, Math.abs(y2 - y1));

        const fieldName = widget.fieldName || widget.id || `field_${formFields.length + 1}`;
        let fieldType: FormFieldType = 'text';
        let fieldValue: string | boolean | string[] = '';
        let options: FormFieldOption[] | undefined = undefined;

        // Determine field type and values
        if (widget.fieldType === 'Tx') {
          fieldType = 'text';
          fieldValue = typeof widget.fieldValue === 'string' ? widget.fieldValue : '';
        } else if (widget.fieldType === 'Btn') {
          if (widget.radioButton) {
            fieldType = 'radio';
            fieldValue = typeof widget.fieldValue === 'string' ? widget.fieldValue : '';
          } else if (widget.checkBox) {
            fieldType = 'checkbox';
            const isChecked =
              widget.fieldValue === 'Yes' ||
              widget.fieldValue === 'On' ||
              widget.fieldValue === true ||
              (widget.exportValue && widget.fieldValue === widget.exportValue);
            fieldValue = Boolean(isChecked);
          } else {
            fieldType = 'button';
          }
        } else if (widget.fieldType === 'Ch') {
          fieldType = 'dropdown';
          fieldValue = typeof widget.fieldValue === 'string' ? widget.fieldValue : '';
          if (Array.isArray(widget.options)) {
            options = widget.options.map((opt: any) => {
              if (typeof opt === 'string') {
                return { value: opt, label: opt };
              }
              return {
                value: opt.exportValue || opt.displayValue || String(opt),
                label: opt.displayValue || opt.exportValue || String(opt),
              };
            });
          }
        } else if (widget.fieldType === 'Sig') {
          fieldType = 'signature';
        }

        const fieldModel: FormFieldModel = {
          id: `${sourceDocId}_${fieldName}_${pageIdx}`,
          name: fieldName,
          pageId: pageModel.id,
          pageIndex: pageIdx,
          type: fieldType,
          rect: [x1, y1, x2, y2],
          x,
          y,
          width,
          height,
          value: fieldValue,
          defaultValue: fieldValue,
          options,
          readOnly: Boolean(widget.readOnly),
          required: Boolean(widget.required),
          multiline: Boolean(widget.multiLine),
          password: Boolean(widget.password),
          maxLen: typeof widget.maxLen === 'number' ? widget.maxLen : undefined,
          comb: Boolean(widget.comb),
          fontSize: widget.defaultAppearanceData?.fontSize || 12,
          fontFamily: widget.defaultAppearanceData?.fontName || 'Inter',
          color: widget.defaultAppearanceData?.fontColor
            ? `#${widget.defaultAppearanceData.fontColor}`
            : undefined,
          backgroundColor: widget.backgroundColor
            ? `rgba(${widget.backgroundColor[0]}, ${widget.backgroundColor[1]}, ${widget.backgroundColor[2]}, 0.8)`
            : undefined,
          borderColor: widget.borderColor
            ? `rgb(${widget.borderColor[0]}, ${widget.borderColor[1]}, ${widget.borderColor[2]})`
            : undefined,
          alignment:
            widget.textAlignment === 1
              ? 'center'
              : widget.textAlignment === 2
              ? 'right'
              : 'left',
        };

        formFields.push(fieldModel);
      }
    }

    if (formFields.length > 0) {
      logger.info('load', `Úspěšně extrahováno ${formFields.length} formulářových polí z PDF`, {
        sourceDocId,
        fieldsCount: formFields.length,
        fieldNames: formFields.map((f) => f.name),
      });
    }

    return formFields;
  } catch (err: any) {
    logger.warn('load', `Chyba při extrakci formulářových polí: ${err?.message || err}`);
    return [];
  }
};

/**
 * Applies form values to a pdf-lib PDFDocument instance and optionally flattens the form
 */
export const applyFormValuesToPdfDocument = (
  pdfDoc: PDFDocument,
  formValues: Record<string, string | boolean | string[]>,
  flatten: boolean = false
): void => {
  try {
    const form = pdfDoc.getForm();
    const fields = form.getFields();

    if (fields.length === 0) return;

    for (const field of fields) {
      const name = field.getName();
      const val = formValues[name];
      if (val === undefined) continue;

      try {
        if (field instanceof PDFTextField) {
          const strVal = String(val ?? '');
          field.setText(strVal);
          // If the text contains non-ASCII characters (Czech diacritics like ěščřžýáíéůúťďň),
          // mark field as clean to prevent pdf-lib's default WinAnsi Helvetica encoder from failing on save,
          // while preserving the full UTF-16BE value in the PDF dictionary so conforming readers render it correctly.
          form.markFieldAsClean(field.ref);
        } else if (field instanceof PDFCheckBox) {
          const shouldCheck =
            val === true ||
            val === 'true' ||
            val === 'Yes' ||
            val === 'On' ||
            val === '1';
          if (shouldCheck) {
            field.check();
          } else {
            field.uncheck();
          }
        } else if (field instanceof PDFRadioGroup) {
          if (typeof val === 'string' && val.trim()) {
            field.select(val);
          }
        } else if (field instanceof PDFDropdown) {
          if (typeof val === 'string' && val.trim()) {
            field.select(val);
          }
          form.markFieldAsClean(field.ref);
        } else if (field instanceof PDFOptionList) {
          const listVals = Array.isArray(val) ? val : [String(val)];
          field.select(listVals);
          form.markFieldAsClean(field.ref);
        }
      } catch (fieldErr) {
        logger.warn('save', `Nelze nastavit hodnotu pole formuláře "${name}": ${fieldErr}`);
      }
    }

    // Set NeedAppearances flag so PDF viewers re-render the form fields using their native Unicode font engines
    try {
      const acroForm = pdfDoc.catalog.getOrCreateAcroForm();
      acroForm.dict.set(PDFName.of('NeedAppearances'), PDFBool.True);
    } catch {
      // ignore
    }

    if (flatten) {
      logger.info('save', 'Provádím zploštění formulářových polí (Form Flattening)...');
      try {
        const pages = pdfDoc.getPages();
        if (pages.length > 0) {
          for (const field of fields) {
            try {
              const widgets = (field as any).acroField.getWidgets();
              for (const widget of widgets) {
                const widgetRef = pdfDoc.context.getObjectRef(widget.dict);
                let matchedPage = widgetRef ? pdfDoc.findPageForAnnotationRef(widgetRef) : undefined;
                if (!matchedPage) {
                  matchedPage = pages[0];
                }
                if (matchedPage) {
                  widget.dict.set(PDFName.of('P'), matchedPage.ref);
                }
              }
            } catch {
              // ignore
            }
          }
        }
        form.flatten();
        logger.success('save', 'Formulář byl úspěšně zploštěn do statického obsahu PDF.');
      } catch (flattenErr) {
        logger.warn('save', `Formulář flattening upozornění: ${flattenErr}`);
      }
    }
  } catch (err) {
    logger.warn('save', `Chyba při zápisu do formuláře PDF: ${err}`);
  }
};
