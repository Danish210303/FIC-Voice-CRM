import React, { useState, useEffect } from 'react';
import { X, Server, CheckCircle2, AlertTriangle, RefreshCw, Globe, ShieldCheck } from 'lucide-react';
import { getBaseUrl, setCustomApiUrl, api } from '../api/client';

interface ApiSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export const ApiSettingsModal: React.FC<ApiSettingsModalProps> = ({
  isOpen,
  onClose,
  onSaved,
}) => {
  const [apiUrl, setApiUrl] = useState<string>('');
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    latencyMs?: number;
  } | null>(null);

  useEffect(() => {
    setApiUrl(getBaseUrl());
    setTestResult(null);
  }, [isOpen]);

  if (!isOpen) return null;

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    const start = Date.now();

    try {
      // Temporary test with provided input
      const targetUrl = apiUrl.trim().replace(/\/+$/, '');
      const healthRes = await fetch(`${targetUrl}/health`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      }).catch(() => fetch(`${targetUrl}/api/health`));

      const latencyMs = Date.now() - start;

      if (healthRes.ok) {
        setTestResult({
          success: true,
          message: `Successfully connected to Render API backend (${latencyMs}ms)`,
          latencyMs,
        });
      } else {
        setTestResult({
          success: false,
          message: `Backend returned status ${healthRes.status}: ${healthRes.statusText}`,
        });
      }
    } catch (err: any) {
      setTestResult({
        success: false,
        message: err.message || 'Unable to reach backend URL. Please check network/CORS settings.',
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = () => {
    const trimmed = apiUrl.trim();
    if (trimmed === import.meta.env.VITE_API_URL || trimmed === '') {
      setCustomApiUrl(null);
    } else {
      setCustomApiUrl(trimmed);
    }
    onSaved();
    onClose();
  };

  const handleResetDefault = () => {
    const envUrl = import.meta.env.VITE_API_URL || 'https://fic-voice-crm.onrender.com';
    setApiUrl(envUrl);
    setCustomApiUrl(null);
    setTestResult(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-950/80 backdrop-blur-sm animate-fadeIn">
      <div className="w-full max-w-lg bg-gray-900 border border-gray-800 rounded-xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-gray-950/60">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-gradient-to-tr from-amber-500/20 to-orange-500/20 text-amber-400 border border-amber-500/30">
              <Server className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-100 text-base">Backend API Settings</h3>
              <p className="text-xs text-gray-400">Configure Render API backend endpoint URL</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 text-sm text-gray-300">
          {/* Quick Presets */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">
              Quick Environments
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setApiUrl('http://localhost:8000');
                  setTestResult(null);
                }}
                className={`px-3 py-2 rounded-lg border text-left text-xs transition flex flex-col gap-0.5 ${
                  apiUrl.includes('localhost') || apiUrl.includes('127.0.0.1')
                    ? 'bg-amber-500/15 border-amber-500/50 text-amber-300'
                    : 'bg-gray-950/60 border-gray-800 text-gray-400 hover:border-gray-700 hover:text-gray-200'
                }`}
              >
                <span className="font-bold flex items-center gap-1.5 text-gray-200">
                  ⚡ Localhost (Port 8000)
                </span>
                <span className="font-mono text-[10px] opacity-75">http://localhost:8000</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setApiUrl('https://fic-voice-crm.onrender.com');
                  setTestResult(null);
                }}
                className={`px-3 py-2 rounded-lg border text-left text-xs transition flex flex-col gap-0.5 ${
                  apiUrl.includes('onrender.com')
                    ? 'bg-amber-500/15 border-amber-500/50 text-amber-300'
                    : 'bg-gray-950/60 border-gray-800 text-gray-400 hover:border-gray-700 hover:text-gray-200'
                }`}
              >
                <span className="font-bold flex items-center gap-1.5 text-gray-200">
                  ☁️ Production Render
                </span>
                <span className="font-mono text-[10px] opacity-75">fic-voice-crm.onrender.com</span>
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">
              API Base URL
            </label>
            <div className="relative flex items-center">
              <Globe className="absolute left-3 w-4 h-4 text-gray-500" />
              <input
                type="url"
                value={apiUrl}
                onChange={(e) => {
                  setApiUrl(e.target.value);
                  setTestResult(null);
                }}
                placeholder="http://localhost:8000 or https://fic-voice-crm.onrender.com"
                className="w-full pl-9 pr-24 py-2.5 bg-gray-950 border border-gray-700/80 rounded-lg text-gray-100 placeholder-gray-600 focus:outline-none focus:border-amber-500 text-sm font-mono transition-colors"
              />
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={isTesting || !apiUrl}
                className="absolute right-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-200 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 border border-gray-700"
              >
                {isTesting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : 'Test Ping'}
              </button>
            </div>
            <p className="mt-2 text-xs text-gray-500">
              Active WebSocket Endpoint: <code className="text-amber-400 font-mono text-[11px]">{apiUrl.startsWith('https') ? 'wss://' : 'ws://'}{apiUrl.replace(/^https?:\/\//, '')}/ws/global</code>
            </p>
          </div>

          {/* Test connection result badge */}
          {testResult && (
            <div
              className={`p-3.5 rounded-lg border flex items-start gap-3 text-xs ${
                testResult.success
                  ? 'bg-emerald-950/40 text-emerald-300 border-emerald-800/60'
                  : 'bg-rose-950/40 text-rose-300 border-rose-800/60'
              }`}
            >
              {testResult.success ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              )}
              <div className="space-y-0.5">
                <span className="font-semibold block">{testResult.success ? 'Connection Successful' : 'Connection Failed'}</span>
                <span>{testResult.message}</span>
              </div>
            </div>
          )}

          {/* Features info */}
          <div className="p-4 rounded-lg bg-gray-950/50 border border-gray-800/80 space-y-2 text-xs text-gray-400">
            <div className="flex items-center gap-2 text-gray-300 font-medium">
              <ShieldCheck className="w-4 h-4 text-amber-400" /> Secure Communications
            </div>
            <ul className="list-disc list-inside space-y-1 pl-1 text-[11px] text-gray-400">
              <li>Automatic Bearer Token Authentication header injection</li>
              <li>HTTPS TLS encryption to Render Cloud endpoints</li>
              <li>Automatic WSS WebSocket connection for live agent calls</li>
            </ul>
          </div>
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-800 bg-gray-950/60">
          <button
            type="button"
            onClick={handleResetDefault}
            className="text-xs text-gray-400 hover:text-amber-400 underline transition-colors"
          >
            Reset to Default
          </button>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-gray-300 hover:text-white bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="px-4 py-2 text-xs font-semibold text-gray-950 bg-gradient-to-r from-amber-400 to-orange-500 hover:from-amber-300 hover:to-orange-400 rounded-lg shadow-lg transition-all"
            >
              Save Configuration
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
