import React, { useState, useEffect } from 'react';
import { Minus, Square, Copy, X, Settings, Activity, Wifi, WifiOff } from 'lucide-react';
import { getBaseUrl, api } from '../api/client';
import { ApiSettingsModal } from './ApiSettingsModal';

interface DesktopTitleBarProps {
  onOpenSettings?: () => void;
}

export const DesktopTitleBar: React.FC<DesktopTitleBarProps> = () => {
  const [isElectron, setIsElectron] = useState<boolean>(false);
  const [isMaximized, setIsMaximized] = useState<boolean>(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [healthStatus, setHealthStatus] = useState<'connected' | 'checking' | 'error'>('checking');
  const [currentUrl, setCurrentUrl] = useState<string>('');

  useEffect(() => {
    const isEl = !!(window as any).electronAPI?.isElectron;
    setIsElectron(isEl);
    setCurrentUrl(getBaseUrl());

    // Periodically check Render API connection status
    const checkConnection = async () => {
      try {
        await api.checkHealth();
        setHealthStatus('connected');
      } catch {
        setHealthStatus('error');
      }
    };

    checkConnection();
    const interval = setInterval(checkConnection, 30000); // Re-check every 30s

    return () => clearInterval(interval);
  }, []);

  const handleMinimize = () => {
    (window as any).electronAPI?.minimizeWindow();
  };

  const handleMaximize = async () => {
    (window as any).electronAPI?.maximizeWindow();
    if ((window as any).electronAPI?.isMaximized) {
      const maxState = await (window as any).electronAPI.isMaximized();
      setIsMaximized(maxState);
    }
  };

  const handleClose = () => {
    (window as any).electronAPI?.closeWindow();
  };

  const handleUrlSaved = () => {
    const newUrl = getBaseUrl();
    setCurrentUrl(newUrl);
    setHealthStatus('checking');
    api.checkHealth()
      .then(() => {
        setHealthStatus('connected');
        if (typeof window !== 'undefined') {
          window.location.reload();
        }
      })
      .catch(() => setHealthStatus('error'));
  };

  // If not running inside Electron desktop wrapper, still render a subtle status bar header option or titlebar when electron is detected
  if (!isElectron) {
    return (
      <>
        {isSettingsOpen && (
          <ApiSettingsModal
            isOpen={isSettingsOpen}
            onClose={() => setIsSettingsOpen(false)}
            onSaved={handleUrlSaved}
          />
        )}
      </>
    );
  }

  return (
    <>
      <div
        className="h-10 bg-gray-950 border-b border-gray-800/80 flex items-center justify-between px-3 select-none z-50 text-xs text-gray-300 font-sans sticky top-0"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {/* App Title & Logo */}
        <div className="flex items-center gap-2.5">
          <div className="w-5 h-5 rounded bg-gradient-to-tr from-amber-500 to-orange-500 flex items-center justify-center text-gray-950 font-bold text-[10px]">
            F
          </div>
          <span className="font-semibold tracking-wide text-gray-200">Forge CRM</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800/90 text-gray-400 font-mono">
            Desktop
          </span>
        </div>

        {/* Center: Render API Connection Status Indicator */}
        <div className="flex items-center gap-3">
          <div
            onClick={() => setIsSettingsOpen(true)}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium cursor-pointer transition-all border ${
              healthStatus === 'connected'
                ? 'bg-emerald-950/40 text-emerald-400 border-emerald-800/50 hover:bg-emerald-900/50'
                : healthStatus === 'checking'
                ? 'bg-amber-950/40 text-amber-400 border-amber-800/50 hover:bg-amber-900/50'
                : 'bg-rose-950/40 text-rose-400 border-rose-800/50 hover:bg-rose-900/50'
            }`}
            title={`API Target: ${currentUrl} (Click to configure API Settings)`}
          >
            {healthStatus === 'connected' && <Wifi className="w-3 h-3 text-emerald-400 animate-pulse" />}
            {healthStatus === 'checking' && <Activity className="w-3 h-3 text-amber-400 animate-spin" />}
            {healthStatus === 'error' && <WifiOff className="w-3 h-3 text-rose-400" />}

            <span>
              {healthStatus === 'connected'
                ? (currentUrl.includes('localhost') || currentUrl.includes('127.0.0.1') ? 'Local API Online' : 'Render API Online')
                : healthStatus === 'checking'
                ? 'Connecting...'
                : 'API Disconnected'}
            </span>
          </div>

          <button
            onClick={() => setIsSettingsOpen(true)}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            className="p-1 rounded text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
            title="Configure Render API URL & Endpoint Settings"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Right: Window Controls */}
        <div
          className="flex items-center"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <button
            onClick={handleMinimize}
            className="w-8 h-8 flex items-center justify-center hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors"
            title="Minimize"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleMaximize}
            className="w-8 h-8 flex items-center justify-center hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors"
            title={isMaximized ? 'Restore' : 'Maximize'}
          >
            {isMaximized ? <Copy className="w-3 h-3 rotate-180" /> : <Square className="w-3 h-3" />}
          </button>
          <button
            onClick={handleClose}
            className="w-8 h-8 flex items-center justify-center hover:bg-rose-600 text-gray-400 hover:text-white transition-colors"
            title="Close"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {isSettingsOpen && (
        <ApiSettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          onSaved={handleUrlSaved}
        />
      )}
    </>
  );
};
