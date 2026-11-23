import {
  PDFDocument,
  PDFFont,
  PDFTextField,
  PDFCheckBox,
  PDFRadioGroup,
  PDFDropdown,
  PDFOptionList,
  PDFName,
  PDFBool,
  PDFRef,
} from 'pdf-lib';
import { FormFieldModel, FormFieldType, FormFieldOption } from '../types/form';
import { PdfPageModel } from '../types/document';
import { getCachedPdfDocument, toViewportRect } from './pdfLoader';
import { prepareTextForFont } from './pdfFonts';
import { logger } from './logger';

const rgbArrayToHex = (raw: unknown): string | undefined => {
  if (!raw) return undefined;
  if (typeof raw === 'string') {
    return raw.startsWith('#') ? raw : `#${raw}`;
  }
  const arr = raw as ArrayLike<number>;
  if (typeof arr.length !== 'number' || arr.length < 3) return undefined;
  let r = Number(arr[0]);
  let g = Number(arr[1]);
  let b = Number(arr[2]);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return undefined;
  if (r <= 1 && g <= 1 && b <= 1 && (r > 0 || g > 0 || b > 0)) {
    r = Math.round(r * 255);
    g = Math.round(g * 255);
    b = Math.round(b * 255);
  } else {
    r = Math.round(Math.max(0, Math.min(255, r)));
    g = Math.round(Math.max(0, Math.min(255, g)));
    b = Math.round(Math.max(0, Math.min(255, b)));
  }
  const hex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
};

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
      let pdfPage: any = null;
      let viewport: any = null;
      try {
        pdfPage = await pdfDoc.getPage(pageModel.originalPageIndex + 1);
        // Widgets are positioned in the displayed (rotated, cropped) page space
        viewport = pdfPage.getViewport({ scale: 1.0, rotation: pageModel.rotation });
        annotations = await pdfPage.getAnnotations({ intent: 'display' });
      } catch (err) {
        logger.warn('load', `Nepodařilo se načíst formulářová pole ze strany ${pageIdx + 1}: ${err}`);
        continue;
      } finally {
        if (pdfPage) {
          try {
            pdfPage.cleanup();
          } catch {
            // ignore
          }
        }
      }

      // Filter for Widget annotations (AcroForm form fields)
      const widgets = annotations.filter(
        (ann) => ann.subtype === 'Widget' || ann.annotationType === 19 // 19 = AnnotationType.WIDGET
      );

      for (let widgetIdx = 0; widgetIdx < widgets.length; widgetIdx++) {
        const widget = widgets[widgetIdx];
        if (!widget.rect || widget.rect.length < 4) continue;

        const [x1, y1, x2, y2] = widget.rect;
        const [vx1, vy1, vx2, vy2] = toViewportRect(viewport, widget.rect);
        const x = Math.min(vx1, vx2);
        const y = Math.min(vy1, vy2);
        const width = Math.max(12, Math.abs(vx2 - vx1));
        const height = Math.max(12, Math.abs(vy2 - vy1));

        const fieldName = widget.fieldName || widget.id || `field_${formFields.length + 1}`;
        let fieldType: FormFieldType = 'text';
        let fieldValue: string | boolean | string[] = '';
        let options: FormFieldOption[] | undefined = undefined;
        let exportValue: string | undefined = undefined;
        let multiSelect = false;

        // Determine field type and values
        if (widget.fieldType === 'Tx') {
          fieldType = 'text';
          fieldValue = typeof widget.fieldValue === 'string' ? widget.fieldValue : '';
        } else if (widget.fieldType === 'Btn') {
          if (widget.radioButton) {
            fieldType = 'radio';
            exportValue =
              typeof widget.buttonValue === 'string' && widget.buttonValue
                ? widget.buttonValue
                : typeof widget.exportValue === 'string' && widget.exportValue
                  ? widget.exportValue
                  : undefined;
            fieldValue = typeof widget.fieldValue === 'string' ? widget.fieldValue : '';
          } else if (widget.checkBox) {
            fieldType = 'checkbox';
            exportValue = typeof widget.exportValue === 'string' ? widget.exportValue : undefined;
            const isChecked =
              widget.fieldValue === 'Yes' ||
              widget.fieldValue === 'On' ||
              widget.fieldValue === true ||
              (exportValue !== undefined && widget.fieldValue === exportValue);
            fieldValue = Boolean(isChecked);
          } else {
            fieldType = 'button';
          }
        } else if (widget.fieldType === 'Ch') {
          const isCombo = widget.combo !== false;
          fieldType = isCombo ? 'dropdown' : 'optionList';
          multiSelect = !isCombo && Boolean(widget.multiSelect);
          if (Array.isArray(widget.fieldValue)) {
            fieldValue = multiSelect
              ? widget.fieldValue.map(String)
              : typeof widget.fieldValue[0] === 'string'
                ? widget.fieldValue[0]
                : '';
          } else if (typeof widget.fieldValue === 'string') {
            fieldValue = multiSelect && widget.fieldValue ? [widget.fieldValue] : widget.fieldValue;
          } else {
            fieldValue = multiSelect ? [] : '';
          }
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

        const widgetKey = widget.id ? String(widget.id) : String(widgetIdx);
        const fieldModel: FormFieldModel = {
          id: `${sourceDocId}_${fieldName}_${pageIdx}_${widgetKey}`,
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
          exportValue,
          multiSelect,
          readOnly: Boolean(widget.readOnly),
          required: Boolean(widget.required),
          multiline: Boolean(widget.multiLine),
          password: Boolean(widget.password),
          maxLen: typeof widget.maxLen === 'number' ? widget.maxLen : undefined,
          comb: Boolean(widget.comb),
          fontSize: widget.defaultAppearanceData?.fontSize || 12,
          fontFamily: widget.defaultAppearanceData?.fontName || 'Inter',
          color: rgbArrayToHex(widget.defaultAppearanceData?.fontColor),
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
          pageRotation: pageModel.rotation,
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
 * Applies form values to a pdf-lib PDFDocument instance and optionally flattens the form.
 * When `flatten` is true, appearance streams are generated with `appearanceFont` (e.g. an embedded
 * Unicode font for Czech/non-WinAnsi characters) BEFORE flattening so filled values are burned in.
 */
export const applyFormValuesToPdfDocument = (
  pdfDoc: PDFDocument,
  formValues: Record<string, string | boolean | string[]>,
  flatten: boolean = false,
  appearanceFont?: PDFFont
): void => {
  try {
    const form = pdfDoc.getForm();
    const fields = form.getFields();

    if (fields.length === 0) return;

    const modifiedTextOrChoiceRefs = new Set<PDFRef>();

    const clearWidgetAppearances = (field: any) => {
      try {
        for (const widget of field.acroField.getWidgets()) {
          widget.dict.delete(PDFName.of('AP'));
        }
      } catch {
        // ignore
      }
    };

    const refreshInteractiveAppearance = (field: PDFTextField | PDFDropdown | PDFOptionList) => {
      // Try generating a fresh standard appearance for WinAnsi values; for non-WinAnsi (e.g. Czech)
      // drop any stale /AP so viewers honouring /NeedAppearances render the new UTF-16BE /V value.
      try {
        (field as any).defaultUpdateAppearances(form.getDefaultFont());
      } catch {
        clearWidgetAppearances(field);
      }
      form.markFieldAsClean(field.ref);
    };

    for (const field of fields) {
      const name = field.getName();
      const val = formValues[name];
      if (val === undefined) continue;

      try {
        if (field instanceof PDFTextField) {
          const strVal = String(val ?? '');
          field.setText(strVal);
          modifiedTextOrChoiceRefs.add(field.ref);
          if (!flatten) {
            refreshInteractiveAppearance(field);
          }
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
          } else if (val === '') {
            field.clear();
          }
        } else if (field instanceof PDFDropdown) {
          if (typeof val === 'string' && val.trim()) {
            field.select(val);
          } else if (val === '') {
            field.clear();
          }
          modifiedTextOrChoiceRefs.add(field.ref);
          if (!flatten) {
            refreshInteractiveAppearance(field);
          }
        } else if (field instanceof PDFOptionList) {
          const listVals = (Array.isArray(val) ? val : [String(val)]).filter(Boolean);
          if (listVals.length > 0) {
            field.select(listVals);
          } else {
            field.clear();
          }
          modifiedTextOrChoiceRefs.add(field.ref);
          if (!flatten) {
            refreshInteractiveAppearance(field);
          }
        }
      } catch (fieldErr) {
        logger.warn('save', `Nelze nastavit hodnotu pole formuláře "${name}": ${fieldErr}`);
      }
    }

    // Set NeedAppearances flag so PDF viewers re-render interactive form fields using native Unicode fonts
    if (!flatten) {
      try {
        const acroForm = pdfDoc.catalog.getOrCreateAcroForm();
        acroForm.dict.set(PDFName.of('NeedAppearances'), PDFBool.True);
      } catch {
        // ignore
      }
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

        // Regenerate appearance streams with the Unicode font (when available) BEFORE flattening so
        // every modified/non-WinAnsi field is visibly burned into the flattened page content stream.
        const defaultFont = form.getDefaultFont();
        for (const field of fields) {
          try {
            const isTextOrChoice =
              field instanceof PDFTextField ||
              field instanceof PDFDropdown ||
              field instanceof PDFOptionList;
            if (isTextOrChoice) {
              const needsUpdate = modifiedTextOrChoiceRefs.has(field.ref) || field.needsAppearancesUpdate();
              if (!needsUpdate) continue;
              const fontToUse = appearanceFont ?? defaultFont;
              try {
                form.markFieldAsDirty(field.ref);
                (field as any).defaultUpdateAppearances(fontToUse);
                form.markFieldAsClean(field.ref);
              } catch {
                // Fallback when no Unicode font could be loaded (e.g. direct sync call in Node):
                // transliterate unsupported characters so the flattened box is never blank.
                if (field instanceof PDFTextField) {
                  const rawText = field.getText() || '';
                  field.setText(prepareTextForFont(defaultFont, rawText));
                  (field as any).defaultUpdateAppearances(defaultFont);
                  form.markFieldAsClean(field.ref);
                } else if (field instanceof PDFDropdown) {
                  const selected = field.getSelected().map((s) => prepareTextForFont(defaultFont, s));
                  if (selected.length > 0) {
                    const existingOpts = field.getOptions();
                    for (const s of selected) {
                      if (!existingOpts.includes(s)) field.addOptions(s);
                    }
                    field.select(selected);
                  }
                  (field as any).defaultUpdateAppearances(defaultFont);
                  form.markFieldAsClean(field.ref);
                } else {
                  form.markFieldAsClean(field.ref);
                }
              }
            } else if (field.needsAppearancesUpdate()) {
              (field as any).defaultUpdateAppearances(defaultFont);
              form.markFieldAsClean(field.ref);
            }
          } catch (apErr) {
            logger.warn('save', `Nelze vygenerovat vzhled pole "${field.getName()}" před zploštěním: ${apErr}`);
            form.markFieldAsClean(field.ref);
          }
        }

        form.flatten({ updateFieldAppearances: false });
        logger.success('save', 'Formulář byl úspěšně zploštěn do statického obsahu PDF.');
      } catch (flattenErr) {
        logger.warn('save', `Formulář flattening upozornění: ${flattenErr}`);
      }
    }
  } catch (err) {
    logger.warn('save', `Chyba při zápisu do formuláře PDF: ${err}`);
  }
};
