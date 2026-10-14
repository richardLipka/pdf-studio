import path from 'node:path';

export interface LaunchFileOptions {
  /** Directory relative paths are resolved against (the working directory of the launching process) */
  cwd: string;
  /** True for an existing regular file */
  isFile: (filePath: string) => boolean;
}

/**
 * Finds the PDF file passed on the command line ("PDF Studio.exe" document.pdf, "Open with",
 * double-click on an associated file). argv[0] is the executable; in development Electron also gets
 * the app folder, and Chromium may append its own --switches, so the first argument that names an
 * existing .pdf file wins.
 */
export const findPdfArgument = (argv: readonly string[], options: LaunchFileOptions): string | null => {
  for (const raw of argv.slice(1)) {
    if (!raw || raw.startsWith('-')) continue;
    const cleaned = raw.replace(/^["'](.*)["']$/, '$1').trim();
    if (!cleaned.toLowerCase().endsWith('.pdf')) continue;
    const resolved = path.isAbsolute(cleaned) ? cleaned : path.resolve(options.cwd, cleaned);
    try {
      if (options.isFile(resolved)) return resolved;
    } catch {
      // unreadable path: try the next argument
    }
  }
  return null;
};
