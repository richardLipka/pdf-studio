import React, { createContext, useContext, useState, useEffect } from 'react';

export type AppTheme = 'default' | 'minimal' | 'lcars';

interface ThemeContextType {
  theme: AppTheme;
  setTheme: (theme: AppTheme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const getInitialTheme = (): AppTheme => {
  if (typeof window === 'undefined') return 'default';

  // 1. Check URL parameters (?theme=... or ?design=...)
  const params = new URLSearchParams(window.location.search);
  const paramTheme = (params.get('theme') || params.get('design') || '').toLowerCase();
  if (paramTheme === 'minimal' || paramTheme === 'light' || paramTheme === 'simple' || paramTheme === 'white') {
    return 'minimal';
  }
  if (paramTheme === 'lcars' || paramTheme === 'tng' || paramTheme === 'startrek' || paramTheme === 'trek') {
    return 'lcars';
  }
  if (paramTheme === 'default' || paramTheme === 'dark' || paramTheme === 'studio') {
    return 'default';
  }

  // 2. Check localStorage
  const saved = localStorage.getItem('pdf_studio_theme') as AppTheme;
  if (saved === 'minimal' || saved === 'lcars' || saved === 'default') {
    return saved;
  }

  return 'default';
};

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<AppTheme>(getInitialTheme);

  // Sync theme to document element and URL query param
  const setTheme = (newTheme: AppTheme) => {
    setThemeState(newTheme);
    try {
      localStorage.setItem('pdf_studio_theme', newTheme);
    } catch {
      // ignore storage error
    }

    // Update URL query param without full page reload
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      if (newTheme === 'default') {
        url.searchParams.delete('theme');
        url.searchParams.delete('design');
      } else {
        url.searchParams.set('theme', newTheme);
        url.searchParams.delete('design');
      }
      window.history.replaceState({}, '', url.toString());
    }
  };

  useEffect(() => {
    // Apply data-theme attribute on root html tag
    document.documentElement.setAttribute('data-theme', theme);
    document.body.className = `theme-${theme}`;

    // Listen for browser Back/Forward navigation changes to URL params
    const handlePopState = () => {
      const current = getInitialTheme();
      setThemeState(current);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = (): ThemeContextType => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
