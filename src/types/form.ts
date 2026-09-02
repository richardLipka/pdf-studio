export type FormFieldType =
  | 'text'
  | 'checkbox'
  | 'radio'
  | 'dropdown'
  | 'optionList'
  | 'button'
  | 'signature';

export interface FormFieldOption {
  value: string;
  label: string;
}

export interface FormFieldModel {
  id: string; // Unique field identifier
  name: string; // PDF field name (/T)
  pageId: string; // ID of the page model where field is located
  pageIndex: number; // 0-based page index
  type: FormFieldType;
  rect: [number, number, number, number]; // [x1, y1, x2, y2] in PDF coordinate system
  x: number; // DOM top-left X in PDF point units
  y: number; // DOM top-left Y in PDF point units
  width: number;
  height: number;
  value: string | boolean | string[]; // Current filled value
  defaultValue?: string | boolean | string[];
  options?: FormFieldOption[]; // For choice / dropdown / radio
  readOnly?: boolean;
  required?: boolean;
  multiline?: boolean;
  password?: boolean;
  maxLen?: number;
  comb?: boolean; // Character cell grid (e.g. for bank account / ID numbers)
  fontSize?: number;
  fontFamily?: string;
  color?: string;
  backgroundColor?: string;
  borderColor?: string;
  alignment?: 'left' | 'center' | 'right';
}

export type FormExportMode = 'interactive' | 'flatten';
