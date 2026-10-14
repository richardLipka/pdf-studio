import React, { createContext, useContext } from 'react';
import { useDesktopIntegration, UseDesktopIntegrationResult } from '../hooks/useDesktopIntegration';

const DesktopContext = createContext<UseDesktopIntegrationResult | null>(null);

export const DesktopProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const desktop = useDesktopIntegration();
  return <DesktopContext.Provider value={desktop}>{children}</DesktopContext.Provider>;
};

export const useDesktop = (): UseDesktopIntegrationResult => {
  const context = useContext(DesktopContext);
  if (!context) {
    // Graceful fallback if called outside DesktopProvider (e.g. isolated test environments)
    return {
      isDesktop: false,
      desktopFilePath: null,
      recentFiles: [],
      openFileDialog: async () => false,
      openRecentFile: async () => false,
      clearRecent: async () => {},
      saveCurrentDocument: async () => false,
      saveCurrentDocumentAs: async () => false,
      setDesktopFilePath: () => {},
    };
  }
  return context;
};
