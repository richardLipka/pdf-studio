import * as forge from 'node-forge';
import {
  PDFDocument,
  PDFName,
  PDFArray,
  PDFDict,
  PDFString,
  PDFHexString,
  PDFNumber,
  PDFFont,
  ParseSpeeds,
} from 'pdf-lib';
import { logger } from './logger';
import { PdfFontProvider, prepareTextForFont } from './pdfFonts';
import { findByteSequence, findBytePattern } from '../utils/binarySearch';

export interface ParsedCertificateInfo {
  commonName: string;
  organization?: string;
  organizationalUnit?: string;
  country?: string;
  email?: string;
  issuerName: string;
  issuerOrganization?: string;
  validFrom: Date;
  validTo: Date;
  serialNumber: string;
  isExpired: boolean;
  keyAlgorithm: string;
}

export interface DigitalSignatureOptions {
  reason?: string;
  location?: string;
  contactInfo?: string;
  signerName?: string;
  pageIndex?: number;
  visualAppearance?: boolean;
  visualSignatureImage?: string; // Optional data URL of handwritten signature
  certificateChain?: string[]; // Optional additional intermediate/root PEM certificates
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface SelfSignedCertOptions {
  commonName: string;
  organization?: string;
  organizationalUnit?: string;
  country?: string;
  email?: string;
  validityDays?: number;
  password?: string;
}

export interface DigitalSignatureResult {
  signedPdfBytes: ArrayBuffer;
  certInfo: ParsedCertificateInfo;
}

/**
 * Parses an X.509 certificate and returns user-friendly metadata.
 */
export function extractCertInfo(cert: forge.pki.Certificate): ParsedCertificateInfo {
  const getField = (attrs: forge.pki.CertificateField[], name: string): string | undefined => {
    const attr = attrs.find((a) => a.name === name || a.shortName === name);
    if (!attr || attr.value === undefined) return undefined;
    const str = String(attr.value);
    try {
      return forge.util.decodeUtf8(str);
    } catch {
      return str;
    }
  };

  const subjectAttrs = cert.subject.attributes;
  const issuerAttrs = cert.issuer.attributes;

  const commonName = getField(subjectAttrs, 'commonName') || 'Neznámý vlastník';
  const organization = getField(subjectAttrs, 'organizationName');
  const organizationalUnit = getField(subjectAttrs, 'organizationalUnitName');
  const country = getField(subjectAttrs, 'countryName');
  const email = getField(subjectAttrs, 'emailAddress');

  const issuerName = getField(issuerAttrs, 'commonName') || commonName;
  const issuerOrganization = getField(issuerAttrs, 'organizationName');

  const validFrom = cert.validity.notBefore;
  const validTo = cert.validity.notAfter;
  const now = new Date();
  const isExpired = now < validFrom || now > validTo;

  let keyAlgorithm = 'RSA-2048';
  const pubKey = cert.publicKey as any;
  if (pubKey && typeof pubKey.n?.bitLength === 'function') {
    const bits = pubKey.n.bitLength();
    if (typeof bits === 'number' && bits > 0) {
      keyAlgorithm = `RSA-${bits}`;
    }
  }

  return {
    commonName,
    organization,
    organizationalUnit,
    country,
    email,
    issuerName,
    issuerOrganization,
    validFrom,
    validTo,
    serialNumber: cert.serialNumber || '00',
    isExpired,
    keyAlgorithm,
  };
}

function rsaKeysMatch(cert: forge.pki.Certificate, privateKey: forge.pki.PrivateKey): boolean {
  try {
    const pub = cert.publicKey as any;
    const priv = privateKey as any;
    if (pub?.n && priv?.n && typeof pub.n.compareTo === 'function') {
      const sameModulus = pub.n.compareTo(priv.n) === 0;
      if (!sameModulus) return false;
      if (pub.e && priv.e && typeof pub.e.compareTo === 'function') {
        return pub.e.compareTo(priv.e) === 0;
      }
      return true;
    }
  } catch {
    // ignore non-RSA keys
  }
  return false;
}

function getLocalKeyId(bag: forge.pkcs12.Bag | undefined): string | undefined {
  const vals = (bag?.attributes as any)?.localKeyId;
  if (Array.isArray(vals) && vals.length > 0) return String(vals[0]);
  return undefined;
}

/**
 * Parses a .p12 / .pfx PKCS#12 file using a password and extracts the private key and X.509 certificate.
 */
export function parsePkcs12(
  arrayBuffer: ArrayBuffer,
  password: string = ''
): {
  privateKeyPem: string;
  certificatePem: string;
  certInfo: ParsedCertificateInfo;
  certificateChain: string[];
} {
  try {
    const binary = forge.util.createBuffer(new Uint8Array(arrayBuffer));
    const p12Asn1 = forge.asn1.fromDer(binary);
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password);

    // Extract private key bag first so we can match the exact leaf certificate in a chain
    let keyBag: forge.pkcs12.Bag | undefined;
    const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
    if (keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]?.length) {
      keyBag = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]!.find((b) => Boolean(b.key)) || keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]![0];
    }
    if (!keyBag?.key) {
      const plainKeyBags = p12.getBags({ bagType: forge.pki.oids.keyBag });
      if (plainKeyBags[forge.pki.oids.keyBag]?.length) {
        keyBag = plainKeyBags[forge.pki.oids.keyBag]!.find((b) => Boolean(b.key)) || plainKeyBags[forge.pki.oids.keyBag]![0];
      }
    }

    if (!keyBag || !keyBag.key) {
      throw new Error('V souboru .p12 nebyl nalezen privátní klíč odpovídající certifikátu.');
    }

    // Extract certificate bags and match the certificate corresponding to the private key
    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
    const rawCertBags = (certBags[forge.pki.oids.certBag] || []).filter((b): b is forge.pkcs12.Bag & { cert: forge.pki.Certificate } => Boolean(b.cert));

    if (rawCertBags.length === 0) {
      throw new Error('V souboru .p12 nebyl nalezen žádný platný X.509 certifikát.');
    }

    const keyLocalId = getLocalKeyId(keyBag);
    let certBag =
      // 1. Authoritative cryptographic match: public key modulus/exponent equals private key
      rawCertBags.find((b) => rsaKeysMatch(b.cert, keyBag!.key!)) ||
      // 2. PKCS#12 localKeyId bag attribute match
      (keyLocalId ? rawCertBags.find((b) => getLocalKeyId(b) === keyLocalId) : undefined) ||
      // 3. Fallback: first non-CA leaf certificate, or first certificate
      rawCertBags.find((b) => {
        const bc = b.cert.getExtension('basicConstraints') as { cA?: boolean } | null;
        return !bc?.cA;
      }) ||
      rawCertBags[0];

    const mainCert = certBag.cert;
    const orderedCerts: forge.pki.Certificate[] = [
      mainCert,
      ...rawCertBags.map((b) => b.cert).filter((c) => c !== mainCert),
    ];

    const privateKeyPem = forge.pki.privateKeyToPem(keyBag.key as forge.pki.rsa.PrivateKey);
    const certificatePem = forge.pki.certificateToPem(mainCert);
    const certInfo = extractCertInfo(mainCert);

    const certificateChain = orderedCerts.map((c) => forge.pki.certificateToPem(c));

    logger.info('crypto', `Úspěšně načten digitální certifikát: ${certInfo.commonName}`, {
      issuer: certInfo.issuerName,
      validTo: certInfo.validTo.toISOString(),
      serial: certInfo.serialNumber,
    });

    return {
      privateKeyPem,
      certificatePem,
      certInfo,
      certificateChain,
    };
  } catch (err: any) {
    logger.error('crypto', `Chyba při čtení certifikátu .p12: ${err.message || err}`, { error: err });
    throw new Error(`Nepodařilo se dešifrovat certifikát. Zkontrolujte správnost hesla. (${err.message || err})`);
  }
}

/**
 * Generates a self-signed X.509 certificate and RSA-2048 private key in pure JS.
 */
export async function generateSelfSignedCertificate(
  options: SelfSignedCertOptions
): Promise<{
  privateKeyPem: string;
  certificatePem: string;
  certInfo: ParsedCertificateInfo;
  p12Buffer: ArrayBuffer;
}> {
  return new Promise((resolve, reject) => {
    try {
      logger.info('crypto', `Generování testovacího RSA klíče a self-signed certifikátu pro: ${options.commonName}`);

      forge.pki.rsa.generateKeyPair({ bits: 2048, workers: -1 }, (err, keypair) => {
        if (err) {
          return reject(err);
        }

        const cert = forge.pki.createCertificate();
        cert.publicKey = keypair.publicKey;
        // RFC 5280 requires a positive serial: the leading 0x01 byte keeps the DER INTEGER's sign bit clear
        cert.serialNumber = '01' + forge.util.bytesToHex(forge.random.getBytesSync(16));

        const now = new Date();
        cert.validity.notBefore = new Date(now.getTime() - 1000 * 60 * 60); // 1 hour ago
        const days = options.validityDays || 365;
        cert.validity.notAfter = new Date(now.getTime() + 1000 * 60 * 60 * 24 * days);

        // RFC 5280 ASN.1 string types: countryName = PrintableString, emailAddress = IA5String, others = UTF8String
        const makeAttr = (
          name: string,
          value: string,
          tagClass: number = forge.asn1.Type.UTF8
        ): forge.pki.CertificateField => {
          return {
            name,
            value,
            valueTagClass: tagClass as any,
          };
        };

        const countryCode = (options.country || 'CZ').trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2) || 'CZ';
        const attrs: forge.pki.CertificateField[] = [
          makeAttr('commonName', options.commonName, forge.asn1.Type.UTF8),
          makeAttr('countryName', countryCode, forge.asn1.Type.PRINTABLESTRING),
          makeAttr('organizationName', options.organization || 'PDF Studio User', forge.asn1.Type.UTF8),
        ];

        if (options.organizationalUnit) {
          attrs.push(makeAttr('organizationalUnitName', options.organizationalUnit, forge.asn1.Type.UTF8));
        }
        if (options.email) {
          attrs.push(makeAttr('emailAddress', options.email, forge.asn1.Type.IA5STRING));
        }

        cert.setSubject(attrs);
        cert.setIssuer(attrs); // Self-signed

        cert.setExtensions([
          {
            name: 'basicConstraints',
            cA: true,
          },
          {
            name: 'keyUsage',
            keyCertSign: true,
            digitalSignature: true,
            nonRepudiation: true,
            keyEncipherment: true,
            dataEncipherment: true,
          },
          {
            name: 'extKeyUsage',
            serverAuth: false,
            clientAuth: true,
            codeSigning: false,
            emailProtection: true,
            timeStamping: true,
          },
        ]);

        // Self-sign certificate with SHA-256
        cert.sign(keypair.privateKey, forge.md.sha256.create());

        const privateKeyPem = forge.pki.privateKeyToPem(keypair.privateKey);
        const certificatePem = forge.pki.certificateToPem(cert);
        const certInfo = extractCertInfo(cert);

        // Package into .p12 format
        const p12Asn1 = forge.pkcs12.toPkcs12Asn1(
          keypair.privateKey,
          [cert],
          options.password || '',
          { generateLocalKeyId: true, friendlyName: options.commonName }
        );
        const p12Der = forge.asn1.toDer(p12Asn1).getBytes();
        const p12Buffer = new Uint8Array(p12Der.length);
        for (let i = 0; i < p12Der.length; i++) {
          p12Buffer[i] = p12Der.charCodeAt(i);
        }

        logger.info('crypto', `Self-signed certifikát úspěšně vytvořen: ${certInfo.commonName}`);

        resolve({
          privateKeyPem,
          certificatePem,
          certInfo,
          p12Buffer: p12Buffer.buffer,
        });
      });
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Signs a PDF ArrayBuffer using an RSA private key and X.509 certificate (PAdES / PKCS#7 detached).
 */
export async function signPdfWithCertificate(
  pdfBytes: ArrayBuffer,
  privateKeyPem: string,
  certificatePem: string,
  options: DigitalSignatureOptions = {}
): Promise<DigitalSignatureResult> {
  const startTime = performance.now();
  logger.info('crypto', 'Zahájení kryptografického podepisování PDF (PAdES / PKCS#7)', {
    reason: options.reason,
    location: options.location,
    visual: options.visualAppearance,
  });

  const pemBlocks = certificatePem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || [certificatePem];
  const allCerts: forge.pki.Certificate[] = [];
  for (const block of pemBlocks) {
    try {
      allCerts.push(forge.pki.certificateFromPem(block));
    } catch {
      // skip invalid block
    }
  }

  if (options.certificateChain) {
    for (const chainPem of options.certificateChain) {
      try {
        const c = forge.pki.certificateFromPem(chainPem);
        if (!allCerts.some((existing) => existing.serialNumber === c.serialNumber)) {
          allCerts.push(c);
        }
      } catch {
        // skip
      }
    }
  }

  if (allCerts.length === 0) {
    throw new Error('V certifikátu nebyl nalezen žádný platný X.509 certifikát pro podepsání.');
  }

  const cert = allCerts[0];
  const privateKey = forge.pki.privateKeyFromPem(privateKeyPem);
  const certInfo = extractCertInfo(cert);

  // 1. Load document with pdf-lib to insert Signature Field & ByteRange placeholder
  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true, parseSpeed: ParseSpeeds.Fast });
  if (pdfDoc.isEncrypted) {
    throw new Error('Šifrovaný PDF dokument nelze přímo kryptograficky podepsat bez předchozího dešifrování.');
  }
  const pages = pdfDoc.getPages();
  if (pages.length === 0) {
    throw new Error('Dokument neobsahuje žádné stránky k podepsání.');
  }
  const pageIdx = Math.max(0, Math.min(options.pageIndex || 0, pages.length - 1));
  const page = pages[pageIdx];

  const signerDisplayName = options.signerName || certInfo.commonName;
  const signDate = new Date();
  const dateStr = formatPdfDate(signDate);

  // Reserve signature placeholder size (16 KB for PKCS#7 DER hex is plenty for certs + chains)
  const SIGNATURE_LENGTH = 16384;
  const placeholderHex = '0'.repeat(SIGNATURE_LENGTH);

  // 2. Create signature dictionary (text strings as UTF-16BE so names like "Jiří" survive intact)
  const sigDict = pdfDoc.context.obj({
    Type: 'Sig',
    Filter: 'Adobe.PPKLite',
    SubFilter: 'adbe.pkcs7.detached',
    ByteRange: [0, 1000000000, 1000000000, 1000000000], // Temporary placeholder numbers with exact length
    Contents: PDFHexString.of(placeholderHex),
    Reason: PDFHexString.fromText(options.reason || 'Elektronicky podepsáno'),
    M: PDFString.of(dateStr),
    Name: PDFHexString.fromText(signerDisplayName),
  });

  if (options.location) {
    sigDict.set(PDFName.of('Location'), PDFHexString.fromText(options.location));
  }
  if (options.contactInfo) {
    sigDict.set(PDFName.of('ContactInfo'), PDFHexString.fromText(options.contactInfo));
  }

  const sigDictRef = pdfDoc.context.register(sigDict);

  // 3. Create Signature Form Field widget
  const sigFieldDict = pdfDoc.context.obj({
    Type: 'Annot',
    Subtype: 'Widget',
    FT: 'Sig',
    T: PDFString.of(`Signature_${Date.now()}`),
    V: sigDictRef,
    P: page.ref,
    F: 132, // Print (4) | Locked (128) per ISO 32000-1 Table 165 / PAdES
  });

  // 4. Visual Appearance Stream (if requested). Without an explicit position the badge goes to the
  // bottom-left corner of the page.
  const hasVisual =
    options.visualAppearance === true ||
    (options.visualAppearance !== false && options.x !== undefined && options.y !== undefined);
  if (hasVisual) {
    const pageBox = page.getCropBox();
    const x = options.x ?? pageBox.x + 36;
    const y = options.y ?? pageBox.y + 36;
    const width = Math.max(160, options.width || 220);
    const height = Math.max(50, options.height || 65);

    sigFieldDict.set(
      PDFName.of('Rect'),
      pdfDoc.context.obj([x, y, x + width, y + height])
    );

    // Hex-encoded text through a font that can draw it (standard or embedded Unicode font)
    const fonts = new PdfFontProvider(pdfDoc);
    const nameLine = signerDisplayName;
    const dateLine = `Digitálně podepsáno: ${signDate.toLocaleDateString('cs-CZ')} ${signDate.toLocaleTimeString('cs-CZ')}`;
    const reasonLine = `Důvod: ${options.reason || 'Schváleno'}`;
    const boldFont = await fonts.fontFor('Helvetica', true, false, nameLine);
    const font = await fonts.fontFor('Helvetica', false, false, dateLine + reasonLine);
    const encode = (f: PDFFont, text: string) => f.encodeText(prepareTextForFont(f, text)).toString();

    const apStream = pdfDoc.context.flateStream(
      `q
0.96 0.97 0.99 rg
0 0 ${width} ${height} re f
0.1 0.4 0.8 RG
1.2 w
0 0 ${width} ${height} re S
Q
q
10 10 ${width - 20} ${height - 20} re W n
BT
/F1 9 Tf
0.1 0.2 0.3 rg
12 ${height - 20} Td
${encode(boldFont, nameLine)} Tj
0 -11 Td
/F2 7 Tf
0.3 0.4 0.5 rg
${encode(font, dateLine)} Tj
0 -9 Td
${encode(font, reasonLine)} Tj
ET
Q
`,
      {
        Type: 'XObject',
        Subtype: 'Form',
        FormType: 1,
        BBox: [0, 0, width, height],
        Resources: {
          Font: {
            F1: boldFont.ref,
            F2: font.ref,
          },
        },
      }
    );

    const apDict = pdfDoc.context.obj({
      N: pdfDoc.context.register(apStream),
    });
    sigFieldDict.set(PDFName.of('AP'), apDict);
  } else {
    // Invisible signature
    sigFieldDict.set(PDFName.of('Rect'), pdfDoc.context.obj([0, 0, 0, 0]));
  }

  const sigFieldRef = pdfDoc.context.register(sigFieldDict);

  // Link widget to Page /Annots (which, like /AcroForm and /Fields, may be an indirect reference)
  const existingAnnots = page.node.lookup(PDFName.of('Annots'));
  let pageAnnots = existingAnnots instanceof PDFArray ? existingAnnots : undefined;
  if (!pageAnnots) {
    pageAnnots = pdfDoc.context.obj([]) as PDFArray;
    page.node.set(PDFName.of('Annots'), pageAnnots);
  }
  pageAnnots.push(sigFieldRef);

  // Link field to Document Catalog /AcroForm
  const catalog = pdfDoc.catalog;
  const existingAcroForm = catalog.lookup(PDFName.of('AcroForm'));
  let acroForm = existingAcroForm instanceof PDFDict ? existingAcroForm : undefined;
  if (!acroForm) {
    acroForm = pdfDoc.context.obj({
      Fields: [],
      SigFlags: 3, // SignaturesExist | AppendOnly
    }) as PDFDict;
    catalog.set(PDFName.of('AcroForm'), acroForm);
  } else {
    const existingSigFlags = acroForm.lookup(PDFName.of('SigFlags'));
    const currentFlags = existingSigFlags instanceof PDFNumber ? existingSigFlags.asNumber() : 0;
    acroForm.set(PDFName.of('SigFlags'), PDFNumber.of(currentFlags | 3));
  }

  const existingFields = acroForm.lookup(PDFName.of('Fields'));
  let formFields = existingFields instanceof PDFArray ? existingFields : undefined;
  if (!formFields) {
    formFields = pdfDoc.context.obj([]) as PDFArray;
    acroForm.set(PDFName.of('Fields'), formFields);
  }
  formFields.push(sigFieldRef);

  // 5. Save PDF bytes with placeholder
  const rawBytes = await pdfDoc.save({ useObjectStreams: false, objectsPerTick: 500 });
  const pdfBuffer = new Uint8Array(rawBytes);

  // 6. Find ByteRange and Contents offsets directly on Uint8Array (Zero String Allocation)
  // Search with `<` and `>` delimiters so an unrelated zero run in an image/font stream is never matched
  const delimitedPlaceholder = `<${placeholderHex}>`;
  const delimitedOffset = findByteSequence(pdfBuffer, delimitedPlaceholder);
  const contentsStart = delimitedOffset !== -1 ? delimitedOffset + 1 : findByteSequence(pdfBuffer, placeholderHex);

  if (contentsStart <= 0 || contentsStart + SIGNATURE_LENGTH >= pdfBuffer.length) {
    throw new Error('Nepodařilo se nalézt vyhrazený prostor pro digitální podpis v PDF struktuře.');
  }

  const contentsEnd = contentsStart + SIGNATURE_LENGTH;
  if (pdfBuffer[contentsStart - 1] !== 0x3c || pdfBuffer[contentsEnd] !== 0x3e) {
    throw new Error('Vyhrazený prostor /Contents nemá očekávané hex ohraničení <...>.');
  }

  const byteRangeRegex = /\/ByteRange\s*\[\s*0\s+1000000000\s+1000000000\s+1000000000\s*\]/;
  const byteRangeMatch = findBytePattern(pdfBuffer, byteRangeRegex);

  if (!byteRangeMatch) {
    throw new Error('Nepodařilo se nalézt ByteRange placeholder v PDF struktuře.');
  }

  const byteRangeOffset = byteRangeMatch.index;
  const matchedPlaceholder = byteRangeMatch.match;

  // 7. Replace ByteRange with exact values (0, contentsStart - 1, contentsEnd + 1, totalLength - (contentsEnd + 1))
  const b1 = 0;
  const b2 = contentsStart - 1; // Excludes '<'
  const b3 = contentsEnd + 1;   // Immediately after '>'
  const b4 = pdfBuffer.length - b3;

  const actualByteRange = `/ByteRange [ ${b1} ${b2} ${b3} ${b4} ]`;
  if (actualByteRange.length > matchedPlaceholder.length) {
    throw new Error('Hodnota /ByteRange překročila délku vyhrazeného placeholderu.');
  }
  const paddedByteRange = actualByteRange.padEnd(matchedPlaceholder.length, ' ');

  // Overwrite ByteRange in binary buffer
  for (let i = 0; i < matchedPlaceholder.length; i++) {
    pdfBuffer[byteRangeOffset + i] = paddedByteRange.charCodeAt(i);
  }

  // 8. Prepare detached content from signed byte ranges (Part 1 + Part 2)
  const part1 = pdfBuffer.subarray(b1, b1 + b2);
  const part2 = pdfBuffer.subarray(b3, b3 + b4);

  const detachedContentBuffer = forge.util.createBuffer();
  appendUint8ToForge(detachedContentBuffer, part1);
  appendUint8ToForge(detachedContentBuffer, part2);

  // 9. Generate PKCS#7 / CMS SignedData detached signature
  const p7 = forge.pkcs7.createSignedData();
  p7.content = detachedContentBuffer;
  for (const c of allCerts) {
    p7.addCertificate(c);
  }

  p7.addSigner({
    key: privateKey,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      {
        type: forge.pki.oids.contentType,
        value: forge.pki.oids.data,
      },
      {
        type: forge.pki.oids.messageDigest,
      },
      {
        type: forge.pki.oids.signingTime,
        value: signDate as any,
      },
    ],
  });

  p7.sign({ detached: true });

  const rawDer = forge.asn1.toDer(p7.toAsn1()).getBytes();
  const hexSignature = forge.util.bytesToHex(rawDer);

  if (hexSignature.length > SIGNATURE_LENGTH) {
    throw new Error(
      `Velikost podpisu (${hexSignature.length} znaků) překročila vyhrazený prostor (${SIGNATURE_LENGTH} znaků).`
    );
  }

  // Pad the signature with zeros up to SIGNATURE_LENGTH
  const paddedHexSig = hexSignature.padEnd(SIGNATURE_LENGTH, '0');

  // 10. Inject hex signature into /Contents placeholder
  for (let i = 0; i < SIGNATURE_LENGTH; i++) {
    pdfBuffer[contentsStart + i] = paddedHexSig.charCodeAt(i);
  }

  const durationMs = Math.round(performance.now() - startTime);
  logger.success('crypto', `PDF dokument úspěšně digitálně podepsán certifikátem: ${certInfo.commonName} (${durationMs} ms)`, {
    signer: signerDisplayName,
    serialNumber: certInfo.serialNumber,
    durationMs,
    pdfSizeKB: (pdfBuffer.length / 1024).toFixed(1),
  });

  const signedPdfBytes =
    pdfBuffer.byteOffset === 0 && pdfBuffer.byteLength === pdfBuffer.buffer.byteLength
      ? pdfBuffer.buffer
      : pdfBuffer.slice().buffer;

  return {
    signedPdfBytes,
    certInfo,
  };
}

export function formatPdfDate(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const min = pad(date.getMinutes());
  const s = pad(date.getSeconds());

  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const absOffset = Math.abs(offsetMin);
  const offsetHours = pad(Math.floor(absOffset / 60));
  const offsetMinutes = pad(absOffset % 60);

  return `D:${y}${m}${d}${h}${min}${s}${sign}${offsetHours}'${offsetMinutes}'`;
}

function appendUint8ToForge(buffer: forge.util.ByteBuffer, u8: Uint8Array): void {
  // Note: TextDecoder('latin1') maps 0x80-0x9F per Windows-1252, corrupting raw binary bytes!
  // String.fromCharCode preserves 0x00-0xFF 1-to-1 and chunked apply avoids per-byte concat overhead.
  const CHUNK_SIZE = 8192;
  for (let i = 0; i < u8.length; i += CHUNK_SIZE) {
    const chunk = u8.subarray(i, Math.min(i + CHUNK_SIZE, u8.length));
    buffer.putBytes(String.fromCharCode.apply(null, chunk as unknown as number[]));
  }
}
