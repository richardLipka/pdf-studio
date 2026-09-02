import { describe, it, expect } from 'vitest';
import * as forge from 'node-forge';
import { PDFDocument } from 'pdf-lib';
import {
  generateSelfSignedCertificate,
  parsePkcs12,
  signPdfWithCertificate,
} from '../src/services/digitalSignatureService';

function extractExactDer(rawBytes: string): string {
  if (rawBytes.length < 2) return rawBytes;
  const b1 = rawBytes.charCodeAt(1);
  let headerLen = 2;
  let contentLen = b1;

  if (b1 & 0x80) {
    const numBytes = b1 & 0x7f;
    headerLen = 2 + numBytes;
    contentLen = 0;
    for (let i = 0; i < numBytes; i++) {
      contentLen = (contentLen << 8) | rawBytes.charCodeAt(2 + i);
    }
  }
  return rawBytes.substring(0, headerLen + contentLen);
}

function uint8ToString(u8: Uint8Array): string {
  let str = '';
  const chunk = 32768;
  for (let i = 0; i < u8.length; i += chunk) {
    str += String.fromCharCode.apply(null, Array.from(u8.subarray(i, i + chunk)));
  }
  return str;
}

describe('Digital Signatures & PAdES PKCS#7 Service', () => {
  it('should generate a valid 2048-bit RSA self-signed X.509 certificate in browser memory', async () => {
    const res = await generateSelfSignedCertificate({
      commonName: 'Ing. Jan Novák',
      organization: 'FAV ZČU',
      email: 'novak@fav.zcu.cz',
      password: 'testpassword123',
      validityDays: 365,
    });

    expect(res.privateKeyPem).toContain('BEGIN RSA PRIVATE KEY');
    expect(res.certificatePem).toContain('BEGIN CERTIFICATE');
    expect(res.certInfo.commonName).toBe('Ing. Jan Novák');
    expect(res.certInfo.organization).toBe('FAV ZČU');
    expect(res.certInfo.isExpired).toBe(false);
    expect(res.certInfo.keyAlgorithm).toBe('RSA-2048');
    expect(res.p12Buffer.byteLength).toBeGreaterThan(500);
  });

  it('should parse a password-protected .p12 PKCS#12 buffer and extract keys and certificates', async () => {
    // Generate .p12
    const generated = await generateSelfSignedCertificate({
      commonName: 'Test Signer',
      organization: 'Security Corp',
      password: 'mypassword',
    });

    // Parse with correct password
    const parsed = parsePkcs12(generated.p12Buffer, 'mypassword');
    expect(parsed.certInfo.commonName).toBe('Test Signer');
    expect(parsed.certInfo.organization).toBe('Security Corp');
    expect(parsed.privateKeyPem).toContain('BEGIN RSA PRIVATE KEY');
    expect(parsed.certificatePem).toContain('BEGIN CERTIFICATE');

    // Attempt to parse with incorrect password should throw
    expect(() => parsePkcs12(generated.p12Buffer, 'wrongpassword')).toThrow();
  });

  it('should digitally sign a PDF document and produce valid ISO 32000-1 /ByteRange and /Contents signatures', async () => {
    // 1. Create simple test PDF
    const testDoc = await PDFDocument.create();
    testDoc.addPage([595, 842]);
    const pdfBytes = await testDoc.save();

    // 2. Generate certificate
    const certData = await generateSelfSignedCertificate({
      commonName: 'Karel Čapek',
      organization: 'Literární Spolek',
      email: 'capek@literatura.cz',
      password: 'pass',
    });

    // 3. Digitally sign PDF
    const signResult = await signPdfWithCertificate(
      pdfBytes.buffer,
      certData.privateKeyPem,
      certData.certificatePem,
      {
        reason: 'Schválení finální verze rukopisu',
        location: 'Praha, CZ',
        visualAppearance: true,
        x: 50,
        y: 100,
        width: 220,
        height: 65,
      }
    );

    expect(signResult.signedPdfBytes).toBeDefined();
    expect(signResult.signedPdfBytes.byteLength).toBeGreaterThan(pdfBytes.byteLength);
    expect(signResult.certInfo.commonName).toBe('Karel Čapek');

    // 4. Verify PDF structure contains ISO 32000-1 digital signature parameters
    const signedBuffer = new Uint8Array(signResult.signedPdfBytes);
    const signedString = new TextDecoder('latin1').decode(signedBuffer);

    expect(signedString).toContain('/Type /Sig');
    expect(signedString).toContain('/Filter /Adobe.PPKLite');
    expect(signedString).toContain('/SubFilter /adbe.pkcs7.detached');
    expect(signedString).toContain('/ByteRange [');
    expect(signedString).toContain('/Contents <');

    // Verify ByteRange contains 4 valid non-placeholder numbers
    const byteRangeMatch = signedString.match(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/);
    expect(byteRangeMatch).not.toBeNull();
    expect(byteRangeMatch).toBeDefined();

    const [_, b1Str, b2Str, b3Str, b4Str] = byteRangeMatch!;
    const b1 = Number(b1Str);
    const b2 = Number(b2Str);
    const b3 = Number(b3Str);
    const b4 = Number(b4Str);

    expect(b1).toBe(0);
    expect(b2).toBeGreaterThan(0);
    expect(b3).toBeGreaterThan(b2);
    expect(b4).toBeGreaterThan(0);
    expect(b3 + b4).toBe(signResult.signedPdfBytes.byteLength);

    // 5. Cryptographic byte-level verification
    // Recompute SHA-256 hash across ByteRanges
    const md = forge.md.sha256.create();
    const part1 = signedBuffer.subarray(b1, b1 + b2);
    const part1Str = uint8ToString(part1);
    md.update(part1Str);
    const part2 = signedBuffer.subarray(b3, b3 + b4);
    const part2Str = uint8ToString(part2);
    md.update(part2Str);
    const recomputedHash = md.digest().toHex();

    // Extract PKCS#7 hex signature from /Contents
    const contentsMatch = signedString.match(/\/Contents\s*<([0-9a-fA-F]+)>/);
    expect(contentsMatch).not.toBeNull();
    const rawContentsHex = contentsMatch![1];

    // Strip padding zeros to get real DER
    const sigBytes = forge.util.hexToBytes(rawContentsHex);
    const exactDer = extractExactDer(sigBytes);
    const p7Asn1 = forge.asn1.fromDer(exactDer);
    const p7 = forge.pkcs7.messageFromAsn1(p7Asn1);

    // Verify cert in PKCS#7 matches signer
    expect(p7.certificates.length).toBeGreaterThanOrEqual(1);
    const embeddedCert = p7.certificates[0];
    const rawCommonName = embeddedCert.subject.attributes.find((a: any) => a.name === 'commonName')?.value;
    const embeddedCommonName = forge.util.decodeUtf8(rawCommonName);
    expect(embeddedCommonName).toBe('Karel Čapek');

    // Verify authenticated messageDigest matches the exact ByteRange hash
    const authAttrs = (p7 as any).rawCapture.authenticatedAttributes;
    expect(authAttrs).toBeDefined();
    const msgDigestAttr = authAttrs.find((a: any) => {
      const oid = forge.asn1.derToOid(a.value[0].value);
      return oid === forge.pki.oids.messageDigest;
    });
    expect(msgDigestAttr).toBeDefined();
    const digestBytes = msgDigestAttr.value[1].value[0].value;
    const embeddedDigestHex = forge.util.bytesToHex(digestBytes);
    expect(embeddedDigestHex).toBe(recomputedHash);

    // Verify SHA-256 algorithm OID
    const digestAlgoOid = forge.asn1.derToOid((p7 as any).rawCapture.digestAlgorithm);
    expect(digestAlgoOid).toBe(forge.pki.oids.sha256);

    // Verify RSA signature presence
    const rawSig = (p7 as any).rawCapture.signature;
    expect(rawSig).toBeDefined();
    expect(rawSig.length).toBeGreaterThanOrEqual(256); // 2048-bit RSA signature = 256 bytes
  });

  it('should support certificate chains and multiple embedded certificates in PKCS#7', async () => {
    const rootCa = await generateSelfSignedCertificate({
      commonName: 'Root CA Authority',
      organization: 'Trust Security Inc',
      password: 'root',
    });

    const signer = await generateSelfSignedCertificate({
      commonName: 'Alice Signer',
      organization: 'Finance Department',
      password: 'alice',
    });

    const doc = await PDFDocument.create();
    doc.addPage([500, 500]);
    const pdfBytes = await doc.save();

    const signed = await signPdfWithCertificate(
      pdfBytes.buffer,
      signer.privateKeyPem,
      signer.certificatePem,
      {
        reason: 'Approval',
        certificateChain: [rootCa.certificatePem],
      }
    );

    expect(signed.signedPdfBytes).toBeDefined();

    // Verify multiple certificates are embedded in PKCS#7
    const signedString = new TextDecoder('latin1').decode(new Uint8Array(signed.signedPdfBytes));
    const contentsMatch = signedString.match(/\/Contents\s*<([0-9a-fA-F]+)>/);
    const p7Asn1 = forge.asn1.fromDer(extractExactDer(forge.util.hexToBytes(contentsMatch![1])));
    const p7 = forge.pkcs7.messageFromAsn1(p7Asn1);

    expect(p7.certificates.length).toBe(2);
  });
});
