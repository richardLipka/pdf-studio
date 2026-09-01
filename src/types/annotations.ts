export type AnnotationType =
  | 'highlight'
  | 'underline'
  | 'strikethrough'
  | 'note'
  | 'text'
  | 'drawing'
  | 'signature'
  | 'shape';

export type ShapeType = 'rectangle' | 'ellipse' | 'arrow' | 'line';

export interface Point {
  x: number;
  y: number;
}

export interface BaseAnnotation {
  id: string;
  pageId: string;       // target page id
  type: AnnotationType;
  x: number;            // 0..pageWidth (PDF point coordinates)
  y: number;            // 0..pageHeight (PDF point coordinates)
  width: number;
  height: number;
  color: string;        // Hex or rgba
  opacity: number;      // 0..1
  comment?: string;     // Attached review comment / note
  author?: string;
  createdAt: number;
  updatedAt: number;
}

export interface HighlightAnnotation extends BaseAnnotation {
  type: 'highlight';
  rects?: { x: number; y: number; width: number; height: number }[];
}

export interface UnderlineAnnotation extends BaseAnnotation {
  type: 'underline';
  strokeWidth: number;
}

export interface StrikethroughAnnotation extends BaseAnnotation {
  type: 'strikethrough';
  strokeWidth: number;
}

export interface NoteAnnotation extends BaseAnnotation {
  type: 'note';
  text: string;
  isOpen?: boolean;
}

export interface TextAnnotation extends BaseAnnotation {
  type: 'text';
  text: string;
  fontSize: number;
  fontFamily: string;
  bold?: boolean;
  italic?: boolean;
  backgroundColor?: string;
}

export interface DrawingAnnotation extends BaseAnnotation {
  type: 'drawing';
  points: Point[];
  strokeWidth: number;
}

export interface SignatureAnnotation extends BaseAnnotation {
  type: 'signature';
  imageDataUrl: string; // PNG with transparency
  signatureType: 'draw' | 'type' | 'upload';
}

export interface ShapeAnnotation extends BaseAnnotation {
  type: 'shape';
  shapeType: ShapeType;
  strokeWidth: number;
  fillColor?: string;
  endPoint?: Point;
}

export type Annotation =
  | HighlightAnnotation
  | UnderlineAnnotation
  | StrikethroughAnnotation
  | NoteAnnotation
  | TextAnnotation
  | DrawingAnnotation
  | SignatureAnnotation
  | ShapeAnnotation;

export type EditorTab = 'review' | 'edit';

export type ToolType =
  | 'select'
  | 'textSelect'
  | 'pan'
  | 'highlight'
  | 'underline'
  | 'strikethrough'
  | 'note'
  | 'text'
  | 'drawing'
  | 'signature'
  | 'shape'
  | 'crop'
  | 'eraser'
  | 'streamReplace';

