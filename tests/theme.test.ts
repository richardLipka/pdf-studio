import { describe, it, expect } from 'vitest';
import { AppTheme } from '../src/context/ThemeContext';

describe('Theme Context and URL Encoding', () => {
  const resolveThemeFromSearch = (search: string, savedStorage?: string | null): AppTheme => {
    const params = new URLSearchParams(search);
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

    if (savedStorage === 'minimal' || savedStorage === 'lcars' || savedStorage === 'default') {
      return savedStorage;
    }

    return 'default';
  };

  it('should parse minimal theme from ?theme=minimal URL query param', () => {
    expect(resolveThemeFromSearch('?theme=minimal')).toBe('minimal');
    expect(resolveThemeFromSearch('?theme=light')).toBe('minimal');
    expect(resolveThemeFromSearch('?design=minimal')).toBe('minimal');
  });

  it('should parse lcars theme from ?theme=lcars URL query param', () => {
    expect(resolveThemeFromSearch('?theme=lcars')).toBe('lcars');
    expect(resolveThemeFromSearch('?theme=tng')).toBe('lcars');
    expect(resolveThemeFromSearch('?design=startrek')).toBe('lcars');
  });

  it('should fallback to default when no param or unrecognized param is provided', () => {
    expect(resolveThemeFromSearch('')).toBe('default');
    expect(resolveThemeFromSearch('?theme=unknown')).toBe('default');
  });

  it('should respect localStorage if no URL query param is present', () => {
    expect(resolveThemeFromSearch('', 'minimal')).toBe('minimal');
    expect(resolveThemeFromSearch('', 'lcars')).toBe('lcars');
    // But URL param overrides localStorage:
    expect(resolveThemeFromSearch('?theme=lcars', 'minimal')).toBe('lcars');
  });
});
