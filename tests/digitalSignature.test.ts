import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import {
  generateSelfSignedCertificate,
  parsePkcs12,
  signPdfWithCertificate,
} from '../src/services/digitalSignatureService';

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
    const signedString = new TextDecoder('latin1').decode(new Uint8Array(signResult.signedPdfBytes));

    expect(signedString).toContain('/Type /Sig');
    expect(signedString).toContain('/Filter /Adobe.PPKLite');
    expect(signedString).toContain('/SubFilter /adbe.pkcs7.detached');
    expect(signedString).toContain('/ByteRange [');
    expect(signedString).toContain('/Contents <');

    // Verify ByteRange contains 4 valid non-placeholder numbers
    const byteRangeMatch = signedString.match(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/);
    expect(byteRangeMatch).not.toBeNull();
    if (byteRangeMatch) {
      const [_, b1, b2, b3, b4] = byteRangeMatch.map(Number);
      expect(b1).toBe(0);
      expect(b2).toBeGreaterThan(0);
      expect(b3).toBeGreaterThan(b2);
      expect(b4).toBeGreaterThan(0);
      expect(b3 + b4).toBe(signResult.signedPdfBytes.byteLength);
    }
  });
});
