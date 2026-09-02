import * as forge from 'node-forge';
import {
  PDFDocument,
  PDFName,
  PDFArray,
  PDFDict,
  PDFString,
  PDFHexString,
  PDFNumber,
  StandardFonts,
} from 'pdf-lib';
import { logger } from './logger';

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
    keyAlgorithm: 'RSA-2048',
  };
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

    // Extract certificate bags
    let certBag: forge.pkcs12.Bag | undefined;
    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
    const allCerts: forge.pki.Certificate[] = [];

    if (certBags[forge.pki.oids.certBag]) {
      for (const bag of certBags[forge.pki.oids.certBag]!) {
        if (bag.cert) {
          allCerts.push(bag.cert);
          if (!certBag) certBag = bag;
        }
      }
    }

    if (!certBag || !certBag.cert) {
      throw new Error('V souboru .p12 nebyl nalezen žádný platný X.509 certifikát.');
    }

    // Extract private key bag
    let keyBag: forge.pkcs12.Bag | undefined;
    const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
    if (keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]) {
      keyBag = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]![0];
    }
    if (!keyBag) {
      const plainKeyBags = p12.getBags({ bagType: forge.pki.oids.keyBag });
      if (plainKeyBags[forge.pki.oids.keyBag]) {
        keyBag = plainKeyBags[forge.pki.oids.keyBag]![0];
      }
    }

    if (!keyBag || !keyBag.key) {
      throw new Error('V souboru .p12 nebyl nalezen privátní klíč odpovídající certifikátu.');
    }

    const mainCert = certBag.cert;
    const privateKeyPem = forge.pki.privateKeyToPem(keyBag.key as forge.pki.rsa.PrivateKey);
    const certificatePem = forge.pki.certificateToPem(mainCert);
    const certInfo = extractCertInfo(mainCert);

    const certificateChain = allCerts.map((c) => forge.pki.certificateToPem(c));

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
        cert.serialNumber = Math.floor(Math.random() * 1000000000).toString(16);

        const now = new Date();
        cert.validity.notBefore = new Date(now.getTime() - 1000 * 60 * 60); // 1 hour ago
        const days = options.validityDays || 365;
        cert.validity.notAfter = new Date(now.getTime() + 1000 * 60 * 60 * 24 * days);

        const makeAttr = (name: string, value: string): forge.pki.CertificateField => {
          return {
            name,
            value,
            valueTagClass: forge.asn1.Type.UTF8 as any,
          };
        };

        const attrs: forge.pki.CertificateField[] = [
          makeAttr('commonName', options.commonName),
          makeAttr('countryName', options.country || 'CZ'),
          makeAttr('organizationName', options.organization || 'PDF Studio User'),
        ];

        if (options.organizationalUnit) {
          attrs.push(makeAttr('organizationalUnitName', options.organizationalUnit));
        }
        if (options.email) {
          attrs.push(makeAttr('emailAddress', options.email));
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

  const cert = forge.pki.certificateFromPem(certificatePem);
  const privateKey = forge.pki.privateKeyFromPem(privateKeyPem);
  const certInfo = extractCertInfo(cert);

  // 1. Load document with pdf-lib to insert Signature Field & ByteRange placeholder
  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const pages = pdfDoc.getPages();
  const pageIdx = Math.min(options.pageIndex || 0, pages.length - 1);
  const page = pages[pageIdx];

  const signerDisplayName = options.signerName || certInfo.commonName;
  const signDate = new Date();
  const dateStr = formatPdfDate(signDate);

  // Reserve signature placeholder size (16 KB for PKCS#7 DER hex is plenty for certs + chains)
  const SIGNATURE_LENGTH = 16384;
  const placeholderHex = '0'.repeat(SIGNATURE_LENGTH);

  // 2. Create signature dictionary
  const sigDict = pdfDoc.context.obj({
    Type: 'Sig',
    Filter: 'Adobe.PPKLite',
    SubFilter: 'adbe.pkcs7.detached',
    ByteRange: [0, 1000000000, 1000000000, 1000000000], // Temporary placeholder numbers with exact length
    Contents: PDFHexString.of(placeholderHex),
    Reason: PDFString.of(options.reason || 'Elektronicky podepsáno'),
    M: PDFString.of(dateStr),
    Name: PDFString.of(signerDisplayName),
  });

  if (options.location) {
    sigDict.set(PDFName.of('Location'), PDFString.of(options.location));
  }
  if (options.contactInfo) {
    sigDict.set(PDFName.of('ContactInfo'), PDFString.of(options.contactInfo));
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
    F: 4, // Print flag
  });

  // 4. Visual Appearance Stream (if requested)
  const hasVisual = options.visualAppearance !== false && options.x !== undefined && options.y !== undefined;
  if (hasVisual) {
    const x = options.x || 50;
    const y = options.y || 50;
    const width = Math.max(160, options.width || 220);
    const height = Math.max(50, options.height || 65);

    sigFieldDict.set(
      PDFName.of('Rect'),
      pdfDoc.context.obj([x, y, x + width, y + height])
    );

    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const apStream = pdfDoc.context.stream(
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
12 ${height - 15} Td
(${escapePdfText(signerDisplayName)}) Tj
0 -11 Td
/F2 7 Tf
0.3 0.4 0.5 rg
(Digit\xE1ln\xEC podeps\xE1no: ${signDate.toLocaleDateString('cs-CZ')} ${signDate.toLocaleTimeString('cs-CZ')}) Tj
0 -9 Td
(D\xF9vod: ${escapePdfText(options.reason || 'Schv\xE1leno')}) Tj
ET
Q
`,
      {
        Type: 'XObject',
        Subtype: 'Form',
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

  // Link widget to Page /Annots
  let pageAnnots = page.node.get(PDFName.of('Annots')) as PDFArray;
  if (!pageAnnots) {
    pageAnnots = pdfDoc.context.obj([]) as PDFArray;
    page.node.set(PDFName.of('Annots'), pageAnnots);
  }
  pageAnnots.push(sigFieldRef);

  // Link field to Document Catalog /AcroForm
  const catalog = pdfDoc.catalog;
  let acroForm = catalog.get(PDFName.of('AcroForm')) as PDFDict;
  if (!acroForm) {
    acroForm = pdfDoc.context.obj({
      Fields: [],
      SigFlags: 3, // SignaturesExist | AppendOnly
    }) as PDFDict;
    catalog.set(PDFName.of('AcroForm'), acroForm);
  } else {
    acroForm.set(PDFName.of('SigFlags'), PDFNumber.of(3));
  }

  let formFields = acroForm.get(PDFName.of('Fields')) as PDFArray;
  if (!formFields) {
    formFields = pdfDoc.context.obj([]) as PDFArray;
    acroForm.set(PDFName.of('Fields'), formFields);
  }
  formFields.push(sigFieldRef);

  // 5. Save PDF bytes with placeholder
  const rawBytes = await pdfDoc.save({ useObjectStreams: false });
  let pdfBuffer = new Uint8Array(rawBytes);

  // 6. Find ByteRange and Contents offsets
  const pdfString = uint8ToString(pdfBuffer);
  const contentsOffset = pdfString.indexOf(placeholderHex);

  if (contentsOffset === -1) {
    throw new Error('Nepodařilo se nalézt vyhrazený prostor pro digitální podpis v PDF struktuře.');
  }

  const contentsStart = contentsOffset;
  const contentsEnd = contentsStart + SIGNATURE_LENGTH;

  const byteRangeRegex = /\/ByteRange\s*\[\s*0\s+1000000000\s+1000000000\s+1000000000\s*\]/;
  const byteRangeMatch = pdfString.match(byteRangeRegex);

  if (!byteRangeMatch || byteRangeMatch.index === undefined) {
    throw new Error('Nepodařilo se nalézt ByteRange placeholder v PDF struktuře.');
  }

  const byteRangeOffset = byteRangeMatch.index;
  const matchedPlaceholder = byteRangeMatch[0];

  // 7. Replace ByteRange with exact values (0, contentsStart - 1, contentsEnd + 1, totalLength - (contentsEnd + 1))
  const b1 = 0;
  const b2 = contentsStart - 1; // Includes '<'
  const b3 = contentsEnd + 1;   // After '>'
  const b4 = pdfBuffer.length - b3;

  const actualByteRange = `/ByteRange [ ${b1} ${b2} ${b3} ${b4} ]`;
  const paddedByteRange = actualByteRange.padEnd(matchedPlaceholder.length, ' ');

  // Overwrite ByteRange in binary buffer
  for (let i = 0; i < matchedPlaceholder.length; i++) {
    pdfBuffer[byteRangeOffset + i] = paddedByteRange.charCodeAt(i);
  }

  // 8. Calculate SHA-256 hash of signed byte ranges
  const md = forge.md.sha256.create();
  // Part 1: [b1 ... b1 + b2]
  const part1 = pdfBuffer.subarray(b1, b1 + b2);
  md.update(forge.util.createBuffer(part1).getBytes());
  // Part 2: [b3 ... b3 + b4]
  const part2 = pdfBuffer.subarray(b3, b3 + b4);
  md.update(forge.util.createBuffer(part2).getBytes());

  const docHash = md.digest().getBytes();

  // 9. Generate PKCS#7 / CMS SignedData detached signature
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(docHash);
  p7.addCertificate(cert);

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
        value: docHash,
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

  return {
    signedPdfBytes: pdfBuffer.buffer,
    certInfo,
  };
}

function formatPdfDate(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const min = pad(date.getMinutes());
  const s = pad(date.getSeconds());
  return `D:${y}${m}${d}${h}${min}${s}+01'00'`;
}

function escapePdfText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function uint8ToString(u8: Uint8Array): string {
  let str = '';
  const chunk = 32768;
  for (let i = 0; i < u8.length; i += chunk) {
    str += String.fromCharCode.apply(null, Array.from(u8.subarray(i, i + chunk)));
  }
  return str;
}
