export interface SignatureStamp {
  id: string;
  title: string;
  imageDataUrl: string; // Base64 data URL
  createdAt: number;
  width?: number;
  height?: number;
  category?: string;
}

export interface StampExportPackage {
  app: 'PDF Studio';
  version: string;
  exportedAt: string;
  stampsCount: number;
  stamps: SignatureStamp[];
}
