import React from 'react';
import { PdfPageModel } from '../../types/document';
import { useDocument } from '../../context/DocumentContext';
import { useTheme } from '../../context/ThemeContext';

interface FormLayerProps {
  page: PdfPageModel;
  scale: number;
}

export const FormLayer: React.FC<FormLayerProps> = ({ page, scale }) => {
  const { theme } = useTheme();
  const { formFields, formValues, updateFormFieldValue } = useDocument();

  const pageFields = formFields.filter((f) => f.pageId === page.id);
  if (pageFields.length === 0) return null;

  const isMinimal = theme === 'minimal';
  const isLcars = theme === 'lcars';

  return (
    <div
      style={{
        width: `${page.width * scale}px`,
        height: `${page.height * scale}px`,
      }}
      className="absolute inset-0 pointer-events-none z-20 overflow-hidden"
    >
      {pageFields.map((field) => {
        const value = formValues[field.name] !== undefined ? formValues[field.name] : field.value;
        const left = field.x * scale;
        const top = field.y * scale;
        const width = field.width * scale;
        const height = field.height * scale;
        const fontSize = Math.max(9, (field.fontSize || 12) * scale);

        const commonClass = `pointer-events-auto transition-all outline-none rounded-xs font-sans ${
          isMinimal
            ? 'bg-blue-50/40 border border-blue-400/80 text-black focus:bg-blue-100/60 focus:border-blue-600 focus:ring-1 focus:ring-blue-500'
            : isLcars
            ? 'bg-[#ff9900]/15 border border-[#ff9900] text-[#ff9900] focus:bg-[#ff9900]/30 focus:border-[#ffcc00] focus:ring-1 focus:ring-[#ffcc00]'
            : 'bg-sky-500/10 border border-sky-400/60 text-slate-100 focus:bg-sky-500/25 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40'
        }`;

        if (field.type === 'text') {
          if (field.multiline) {
            return (
              <textarea
                key={field.id}
                style={{
                  position: 'absolute',
                  left: `${left}px`,
                  top: `${top}px`,
                  width: `${width}px`,
                  height: `${height}px`,
                  fontSize: `${fontSize}px`,
                  resize: 'none',
                }}
                disabled={field.readOnly}
                required={field.required}
                maxLength={field.maxLen}
                value={String(value ?? '')}
                onChange={(e) => updateFormFieldValue(field.name, e.target.value)}
                className={`${commonClass} p-1 leading-tight`}
                title={field.name}
              />
            );
          }

          return (
            <input
              key={field.id}
              type={field.password ? 'password' : 'text'}
              style={{
                position: 'absolute',
                left: `${left}px`,
                top: `${top}px`,
                width: `${width}px`,
                height: `${height}px`,
                fontSize: `${fontSize}px`,
              }}
              disabled={field.readOnly}
              required={field.required}
              maxLength={field.maxLen}
              value={String(value ?? '')}
              onChange={(e) => updateFormFieldValue(field.name, e.target.value)}
              className={`${commonClass} px-1.5 flex items-center`}
              title={field.name}
            />
          );
        }

        if (field.type === 'checkbox') {
          const isChecked = Boolean(value);
          return (
            <label
              key={field.id}
              style={{
                position: 'absolute',
                left: `${left}px`,
                top: `${top}px`,
                width: `${width}px`,
                height: `${height}px`,
              }}
              className="pointer-events-auto flex items-center justify-center cursor-pointer select-none"
              title={field.name}
            >
              <input
                type="checkbox"
                disabled={field.readOnly}
                required={field.required}
                checked={isChecked}
                onChange={(e) => updateFormFieldValue(field.name, e.target.checked)}
                className="sr-only"
              />
              <div
                style={{
                  width: `${Math.min(width, height)}px`,
                  height: `${Math.min(width, height)}px`,
                }}
                className={`flex items-center justify-center rounded-xs transition-colors ${
                  isChecked
                    ? isMinimal
                      ? 'bg-blue-600 border border-blue-700 text-white'
                      : isLcars
                      ? 'bg-[#ff9900] border border-[#ffcc00] text-black'
                      : 'bg-sky-500 border border-sky-400 text-slate-950'
                    : isMinimal
                    ? 'bg-blue-50/40 border border-blue-400/80 hover:bg-blue-100/60'
                    : isLcars
                    ? 'bg-[#ff9900]/15 border border-[#ff9900] hover:bg-[#ff9900]/30'
                    : 'bg-sky-500/10 border border-sky-400/60 hover:bg-sky-500/25'
                }`}
              >
                {isChecked && (
                  <svg
                    className="w-3/4 h-3/4 stroke-current"
                    viewBox="0 0 24 24"
                    fill="none"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </div>
            </label>
          );
        }

        if (field.type === 'dropdown') {
          return (
            <select
              key={field.id}
              style={{
                position: 'absolute',
                left: `${left}px`,
                top: `${top}px`,
                width: `${width}px`,
                height: `${height}px`,
                fontSize: `${fontSize}px`,
              }}
              disabled={field.readOnly}
              required={field.required}
              value={String(value ?? '')}
              onChange={(e) => updateFormFieldValue(field.name, e.target.value)}
              className={`${commonClass} px-1 cursor-pointer`}
              title={field.name}
            >
              {field.options && field.options.length > 0 ? (
                field.options.map((opt, optIdx) => (
                  <option key={optIdx} value={opt.value} className="bg-slate-900 text-slate-100">
                    {opt.label}
                  </option>
                ))
              ) : (
                <option value={String(value ?? '')}>{String(value ?? '')}</option>
              )}
            </select>
          );
        }

        return null;
      })}
    </div>
  );
};
