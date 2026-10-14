import React from 'react';
import { useI18n } from '../../i18n/context';
import { useTheme } from '../../context/ThemeContext';
import { useEditor } from '../../context/EditorContext';
import {
  FileText,
  X,
  ExternalLink,
  Github,
  Mail,
  ShieldCheck,
  Award,
} from 'lucide-react';
import { isDesktopApp } from '../../services/desktopBridge';

export interface InternalLibraryInfo {
  name: string;
  category: string;
  roleCs: string;
  roleEn: string;
  url: string;
  license: string;
}

export const INTERNAL_LIBRARIES: InternalLibraryInfo[] = [
  {
    name: 'pdf-lib',
    category: 'Core Engine',
    roleCs: 'Nízkoúrovňová modifikace binární struktury PDF, oprava stromu stránek (PageTree), ISO 32000-1 vzhledové toky (/AP /N) a interaktivní formuláře (AcroForms)',
    roleEn: 'Low-level PDF binary manipulation, PageTree repairing, ISO 32000-1 appearance streams (/AP /N), and interactive AcroForms',
    url: 'https://pdf-lib.js.org/',
    license: 'MIT',
  },
  {
    name: 'pdfjs-dist (Mozilla PDF.js)',
    category: 'Rendering Engine',
    roleCs: 'Vysokorychlostní vykreslování PDF do HTML5 Canvasu, Web Worker parser, extrakce textové vrstvy, záložek (/Outlines) a ohraničení znaků',
    roleEn: 'High-performance PDF canvas rendering engine, Web Worker stream decoder, text layer parsing, bookmarks (/Outlines), and character bounding boxes',
    url: 'https://mozilla.github.io/pdf.js/',
    license: 'Apache 2.0',
  },
  {
    name: 'signature_pad',
    category: 'Signatures',
    roleCs: 'Hladké vektorové zachytávání křivek s interpolací tlaku pro myš, stylus a dotykový displej',
    roleEn: 'Smooth vector curve handwriting capture with pressure interpolation for stylus, touch, and mouse',
    url: 'https://github.com/szimek/signature_pad',
    license: 'MIT',
  },
  {
    name: 'fontkit',
    category: 'Typography',
    roleCs: 'Extrakce glyfů a metrik písem, Unicode diakritika a TrueType/OpenType font subsetting pro česká písmena',
    roleEn: 'Font glyph & metric extraction, Unicode diacritics mapping, and font subsetting for accented characters',
    url: 'https://github.com/foliojs/fontkit',
    license: 'MIT',
  },
  {
    name: 'lucide-react',
    category: 'Design System',
    roleCs: 'Ucelená vektorová sada moderních systémových ikon',
    roleEn: 'Clean, modern vector iconography system',
    url: 'https://lucide.dev/',
    license: 'ISC',
  },
  {
    name: 'React 18 & TypeScript & Vite',
    category: 'Platform Architecture',
    roleCs: 'Reaktivní komponentová architektura, striktní statická typová bezpečnost a bleskové HMR sestavení',
    roleEn: 'Reactive component architecture, strict type-safety, and instant Hot Module Replacement development',
    url: 'https://react.dev/',
    license: 'MIT',
  },
  {
    name: 'Tailwind CSS',
    category: 'Styling',
    roleCs: 'Dynamický designový systém pro témata Studio (tmavý), Minimal (světlý) a LCARS (24. století)',
    roleEn: 'Dynamic design system powering Studio (Dark), Minimal (Light), and LCARS (24th-century) themes',
    url: 'https://tailwindcss.com/',
    license: 'MIT',
  },
  {
    name: 'Vitest',
    category: 'Testing',
    roleCs: 'Automatizovaný integrační a jednotkový testovací framework ověřující reálné PDF soubory',
    roleEn: 'Automated integration and unit testing framework verifying real-world PDF documents',
    url: 'https://vitest.dev/',
    license: 'MIT',
  },
];

interface AboutModalProps {
  open?: boolean;
  onClose?: () => void;
}

export const AboutModal: React.FC<AboutModalProps> = ({ open, onClose }) => {
  const { t, language } = useI18n();
  const { theme } = useTheme();
  const editor = useEditor();

  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : editor.isAboutModalOpen;

  const handleClose = () => {
    if (onClose) {
      onClose();
    } else {
      editor.setIsAboutModalOpen(false);
    }
  };

  if (!isOpen) return null;

  const isMinimal = theme === 'minimal';
  const isLcars = theme === 'lcars';
  const tAbout = t.aboutModal;

  const handleOpenLink = (url: string) => {
    if (typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div
        className={`w-full max-w-2xl max-h-[92vh] flex flex-col animate-in fade-in zoom-in-95 duration-200 border shadow-2xl overflow-hidden ${
          isMinimal
            ? 'rounded-2xl bg-white border-neutral-200 text-neutral-900'
            : isLcars
            ? 'rounded-2xl bg-black border-2 border-[#ff9900] shadow-[0_0_30px_rgba(255,153,0,0.4)] text-[#ff9900]'
            : 'rounded-2xl bg-slate-900 border-slate-700/80 text-white shadow-2xl'
        }`}
      >
        {/* Header */}
        <div
          className={`flex items-center justify-between px-6 py-4 border-b shrink-0 ${
            isMinimal
              ? 'border-neutral-200 bg-neutral-50/80'
              : isLcars
              ? 'border-[#ff9900]/40 bg-[#111111]'
              : 'border-slate-800 bg-slate-950/50'
          }`}
        >
          <div className="flex items-center gap-3">
            <div
              className={`p-2 rounded-xl flex items-center justify-center ${
                isMinimal
                  ? 'bg-neutral-100 text-neutral-800 border border-neutral-200'
                  : isLcars
                  ? 'bg-[#ff9900] text-black font-bold'
                  : 'bg-sky-500/20 text-sky-400 border border-sky-500/30'
              }`}
            >
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h2
                className={`text-base font-bold tracking-wide ${
                  isMinimal ? 'text-black' : isLcars ? 'text-[#ff9900] uppercase font-mono' : 'text-white'
                }`}
              >
                {tAbout.title}
              </h2>
              <p
                className={`text-xs ${
                  isMinimal ? 'text-neutral-500' : isLcars ? 'text-[#ff9966]' : 'text-slate-400'
                }`}
              >
                {tAbout.subtitle}
              </p>
            </div>
          </div>

          <button
            onClick={handleClose}
            className={`p-2 rounded-xl transition-all ${
              isMinimal
                ? 'hover:bg-neutral-100 text-neutral-600'
                : isLcars
                ? 'hover:bg-[#ff9900]/20 text-[#ff9900]'
                : 'hover:bg-slate-800 text-slate-400 hover:text-white'
            }`}
            title={tAbout.close}
            aria-label={tAbout.close}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
          {/* App Hero Card */}
          <div
            className={`p-5 rounded-xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 ${
              isMinimal
                ? 'bg-neutral-50 border-neutral-200'
                : isLcars
                ? 'bg-[#111111] border-[#ff9900]/40'
                : 'bg-slate-800/40 border-slate-700/60'
            }`}
          >
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xl font-bold tracking-tight">PDF Studio</span>
                <span
                  className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                    isMinimal
                      ? 'bg-neutral-200 text-neutral-800'
                      : isLcars
                      ? 'bg-[#ff9900] text-black font-mono font-bold'
                      : 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                  }`}
                >
                  v2.0.0
                </span>
                <span
                  className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                    isDesktopApp()
                      ? isMinimal
                        ? 'bg-neutral-100 text-neutral-700 border border-neutral-300'
                        : isLcars
                        ? 'bg-[#111111] text-[#ff9900] border border-[#ff9900]'
                        : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : isMinimal
                      ? 'bg-neutral-100 text-neutral-700 border border-neutral-300'
                      : isLcars
                      ? 'bg-[#111111] text-[#99ccff] border border-[#99ccff]'
                      : 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                  }`}
                >
                  {isDesktopApp()
                    ? language === 'cs'
                      ? 'Desktopová verze (Offline)'
                      : 'Desktop Edition (Offline)'
                    : language === 'cs'
                    ? 'Webová verze (Online)'
                    : 'Web Edition (Online)'}
                </span>
              </div>
              <p
                className={`text-xs max-w-md leading-relaxed ${
                  isMinimal ? 'text-neutral-600' : isLcars ? 'text-[#ffcc99]' : 'text-slate-300'
                }`}
              >
                {tAbout.description}
              </p>
            </div>

            {/* GitHub Repo Button */}
            <button
              onClick={() => handleOpenLink('https://github.com/richardLipka/pdf-studio')}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold shrink-0 transition-all shadow-md active:scale-95 ${
                isMinimal
                  ? 'bg-black text-white hover:bg-neutral-800'
                  : isLcars
                  ? 'bg-[#ff9900] text-black hover:bg-[#ffcc00] font-bold font-mono'
                  : 'bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white shadow-sky-500/20'
              }`}
            >
              <Github className="w-4 h-4" />
              <span>{tAbout.githubButton}</span>
              <ExternalLink className="w-3.5 h-3.5 opacity-80" />
            </button>
          </div>

          {/* Author & Academic Affiliation Card */}
          <div
            className={`p-4 rounded-xl border space-y-2 ${
              isMinimal
                ? 'bg-white border-neutral-200'
                : isLcars
                ? 'bg-black border-[#ff9900]/30'
                : 'bg-slate-800/30 border-slate-800'
            }`}
          >
            <div className="flex items-center gap-2">
              <Award className={`w-4 h-4 ${isLcars ? 'text-[#ff9900]' : 'text-amber-400'}`} />
              <h3 className="text-xs font-bold uppercase tracking-wider">{tAbout.authorTitle}</h3>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1 text-xs">
              <div>
                <a
                  href="https://home.zcu.cz/~lipka/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-bold hover:underline transition-colors text-sm"
                >
                  {tAbout.authorName}
                </a>
                <p
                  className={`text-[11px] mt-0.5 ${
                    isMinimal ? 'text-neutral-500' : isLcars ? 'text-[#ffcc99]' : 'text-slate-400'
                  }`}
                >
                  {tAbout.authorInstitution}
                </p>
              </div>
              <a
                href="mailto:lipka@fav.zcu.cz"
                className={`inline-flex items-center gap-1.5 font-mono text-[11px] hover:underline ${
                  isMinimal ? 'text-neutral-700' : isLcars ? 'text-[#99ccff]' : 'text-sky-400'
                }`}
              >
                <Mail className="w-3.5 h-3.5" />
                <span>{tAbout.authorEmail}</span>
              </a>
            </div>
          </div>

          {/* Privacy & Security Guarantee */}
          <div
            className={`p-4 rounded-xl border flex items-start gap-3 ${
              isMinimal
                ? 'bg-emerald-50/50 border-emerald-200 text-emerald-950'
                : isLcars
                ? 'bg-[#111111] border-[#33cc66] text-[#33cc66]'
                : 'bg-emerald-950/20 border-emerald-800/40 text-emerald-300'
            }`}
          >
            <ShieldCheck className="w-5 h-5 shrink-0 mt-0.5 text-emerald-500" />
            <div className="space-y-1">
              <h4 className="text-xs font-bold">{tAbout.privacyTitle}</h4>
              <p
                className={`text-[11px] leading-relaxed ${
                  isMinimal ? 'text-emerald-900/80' : isLcars ? 'text-[#66ff99]' : 'text-emerald-300/80'
                }`}
              >
                {tAbout.privacyDesc}
              </p>
            </div>
          </div>

          {/* Internal Libraries & Credentials */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider">{tAbout.librariesTitle}</h3>
                <p
                  className={`text-[11px] ${
                    isMinimal ? 'text-neutral-500' : isLcars ? 'text-[#ff9966]' : 'text-slate-400'
                  }`}
                >
                  {tAbout.librariesSubtitle}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {INTERNAL_LIBRARIES.map((lib) => (
                <div
                  key={lib.name}
                  onClick={() => handleOpenLink(lib.url)}
                  className={`p-3 rounded-xl border transition-all cursor-pointer group flex flex-col justify-between ${
                    isMinimal
                      ? 'bg-neutral-50 hover:bg-neutral-100 border-neutral-200'
                      : isLcars
                      ? 'bg-black hover:bg-[#111111] border-[#ff9900]/30 hover:border-[#ff9900]'
                      : 'bg-slate-800/40 hover:bg-slate-800 border-slate-700/50 hover:border-slate-600'
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-xs group-hover:text-sky-400 transition-colors flex items-center gap-1.5">
                        <span>{lib.name}</span>
                        <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </span>
                      <span
                        className={`text-[9.5px] font-mono px-1.5 py-0.5 rounded ${
                          isMinimal
                            ? 'bg-neutral-200 text-neutral-700'
                            : isLcars
                            ? 'bg-[#333333] text-[#ff9900]'
                            : 'bg-slate-700 text-slate-300'
                        }`}
                      >
                        {lib.license}
                      </span>
                    </div>
                    <p
                      className={`text-[10.5px] leading-relaxed ${
                        isMinimal ? 'text-neutral-600' : isLcars ? 'text-[#ffcc99]' : 'text-slate-400'
                      }`}
                    >
                      {language === 'cs' ? lib.roleCs : lib.roleEn}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          className={`flex items-center justify-between px-6 py-3 border-t shrink-0 ${
            isMinimal
              ? 'border-neutral-200 bg-neutral-50/80 text-neutral-600'
              : isLcars
              ? 'border-[#ff9900]/40 bg-[#111111] text-[#ff9900]'
              : 'border-slate-800 bg-slate-950/60 text-slate-400'
          }`}
        >
          <div className="flex items-center gap-2 text-[11px]">
            <span>{tAbout.licenseTitle}</span>
            <span>•</span>
            <span>Faculty of Applied Sciences (FAV ZČU)</span>
          </div>

          <button
            onClick={handleClose}
            className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-all ${
              isMinimal
                ? 'bg-neutral-200 hover:bg-neutral-300 text-black'
                : isLcars
                ? 'bg-[#ff9900] hover:bg-[#ffcc00] text-black font-bold font-mono'
                : 'bg-slate-800 hover:bg-slate-700 text-white border border-slate-700'
            }`}
          >
            {tAbout.close}
          </button>
        </div>
      </div>
    </div>
  );
};
