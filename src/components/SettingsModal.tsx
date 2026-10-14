'use client';

import React, { useState } from 'react';
import {
  X,
  Settings as SettingsIcon,
  Wifi,
  Video,
  Radio,
  Sliders,
  CheckCircle,
  AlertTriangle,
  RotateCcw,
  Server,
  Key,
} from 'lucide-react';
import { RobotSettings } from '@/types/robot';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: RobotSettings;
  onSaveSettings: (settings: RobotSettings) => void;
  onTestConnection: (ip: string) => Promise<{ success: boolean; latencyMs?: number; error?: string }>;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onSaveSettings,
  onTestConnection,
}) => {
  const [formData, setFormData] = useState<RobotSettings>(settings);
  const [testResult, setTestResult] = useState<{
    status: 'idle' | 'testing' | 'success' | 'failed';
    message?: string;
  }>({ status: 'idle' });
  const [pcTestResult, setPcTestResult] = useState<{
    status: 'idle' | 'testing' | 'success' | 'failed';
    message?: string;
  }>({ status: 'idle' });

  if (!isOpen) return null;

  const handleTest = async () => {
    setTestResult({ status: 'testing' });
    const res = await onTestConnection(formData.robotIp);
    if (res.success) {
      setTestResult({
        status: 'success',
        message: `ESP32-CAM reachable! Latency: ${res.latencyMs}ms`,
      });
    } else {
      setTestResult({
        status: 'failed',
        message: res.error || 'Connection timed out. Check IP and Wi-Fi.',
      });
    }
  };

  const handleTestPcBackend = async () => {
    setPcTestResult({ status: 'testing' });
    try {
      const url = `${formData.pcBackendUrl.replace(/\/+$/, '')}/health`;
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (res.ok) {
        const data = await res.json();
        setPcTestResult({
          status: 'success',
          message: `PC Backend online! Service: ${data.service}`,
        });
      } else {
        setPcTestResult({
          status: 'failed',
          message: `HTTP ${res.status}: Check app.py`,
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unreachable';
      setPcTestResult({
        status: 'failed',
        message: `Could not reach ${formData.pcBackendUrl}: ${msg}`,
      });
    }
  };

  const handleSave = () => {
    onSaveSettings(formData);
    onClose();
  };

  const applyPreset = (preset: 'ap' | 'sim' | 'local') => {
    if (preset === 'ap') {
      setFormData((prev) => ({
        ...prev,
        robotIp: 'http://192.168.4.1',
        cameraStreamUrl: 'http://192.168.4.1:81/stream',
        usePcRelay: true,
        isSimulated: false,
      }));
    } else if (preset === 'sim') {
      setFormData((prev) => ({
        ...prev,
        robotIp: 'http://192.168.4.1',
        cameraStreamUrl: 'http://192.168.4.1:81/stream',
        isSimulated: true,
      }));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="relative w-full max-w-lg bg-slate-950 border border-cyan-500/40 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-slate-900 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <SettingsIcon className="w-5 h-5 text-cyan-400" />
            <h2 className="text-sm font-mono font-bold uppercase tracking-wider text-slate-100">
              NEX-ROVER System Configuration
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 space-y-4 overflow-y-auto font-mono text-xs">
          {/* Quick Config Presets */}
          <div>
            <label className="block text-slate-400 font-semibold mb-1.5">
              Quick Setup Presets:
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => applyPreset('sim')}
                className={`p-2 rounded-lg border text-left transition-all ${
                  formData.isSimulated
                    ? 'bg-amber-500/20 border-amber-400/50 text-amber-200'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                <div className="font-bold">🧪 Simulation Mode</div>
                <div className="text-[10px] text-slate-500 mt-0.5">
                  Test dashboard without physical robot
                </div>
              </button>

              <button
                type="button"
                onClick={() => applyPreset('ap')}
                className={`p-2 rounded-lg border text-left transition-all ${
                  !formData.isSimulated
                    ? 'bg-cyan-500/20 border-cyan-400/50 text-cyan-200'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                <div className="font-bold">📡 ESP32 AP + PC Relay</div>
                <div className="text-[10px] text-slate-500 mt-0.5">
                  Default IP 192.168.4.1 (ESP32 Hotspot)
                </div>
              </button>
            </div>
          </div>

          {/* Simulation Toggle */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-slate-900/80 border border-slate-800">
            <div>
              <span className="font-bold text-slate-200">Simulation / Demo Mode</span>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Emulates telemetry, sensor readings, and motors when hardware is offline.
              </p>
            </div>
            <input
              type="checkbox"
              checked={formData.isSimulated}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, isSimulated: e.target.checked }))
              }
              className="w-5 h-5 rounded bg-slate-950 border-slate-700 accent-amber-500 cursor-pointer"
            />
          </div>

          {/* PC Backend Relay Configuration */}
          <div className="p-3 rounded-lg bg-slate-900/90 border border-cyan-500/30 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-200 flex items-center gap-1.5">
                <Server className="w-4 h-4 text-cyan-400" />
                PC Backend Relay (Recommended for HTTPS)
              </span>
              <input
                type="checkbox"
                checked={formData.usePcRelay}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, usePcRelay: e.target.checked }))
                }
                className="w-4 h-4 rounded bg-slate-950 accent-cyan-400 cursor-pointer"
              />
            </div>
            <p className="text-[10px] text-slate-400">
              When enabled, commands are relayed through your local PC backend to avoid HTTPS-to-HTTP mixed content blocks.
            </p>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">
                PC Backend URL:
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={formData.pcBackendUrl || ''}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, pcBackendUrl: e.target.value }))
                  }
                  placeholder="http://127.0.0.1:5000"
                  className="flex-1 bg-slate-950 border border-slate-800 focus:border-cyan-400 px-3 py-1.5 rounded-lg text-slate-100 font-mono text-xs focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleTestPcBackend}
                  disabled={pcTestResult.status === 'testing'}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-cyan-300 font-bold text-xs"
                >
                  {pcTestResult.status === 'testing' ? 'Testing...' : 'Test PC'}
                </button>
              </div>
              {pcTestResult.status === 'success' && (
                <p className="flex items-center gap-1 text-[10px] text-emerald-400 mt-1">
                  <CheckCircle className="w-3 h-3" /> {pcTestResult.message}
                </p>
              )}
              {pcTestResult.status === 'failed' && (
                <p className="flex items-center gap-1 text-[10px] text-rose-400 mt-1">
                  <AlertTriangle className="w-3 h-3" /> {pcTestResult.message}
                </p>
              )}
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1 flex items-center gap-1">
                <Key className="w-3 h-3 text-cyan-400" />
                Rover Secret Token (X-Rover-Token):
              </label>
              <input
                type="password"
                value={formData.roverToken || ''}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, roverToken: e.target.value }))
                }
                placeholder="Matches ROVER_TOKEN in pc_backend/.env"
                className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-400 px-3 py-1.5 rounded-lg text-slate-100 font-mono text-xs focus:outline-none"
              />
            </div>
          </div>

          {/* ESP32-CAM Address */}
          <div>
            <label className="block text-slate-300 font-semibold mb-1 flex items-center gap-1.5">
              <Wifi className="w-4 h-4 text-cyan-400" />
              ESP32-CAM Direct Address
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={formData.robotIp}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, robotIp: e.target.value }))
                }
                placeholder="http://192.168.4.1"
                className="flex-1 bg-slate-900 border border-slate-800 focus:border-cyan-400 px-3 py-2 rounded-lg text-slate-100 font-mono text-xs focus:outline-none"
              />
              <button
                type="button"
                onClick={handleTest}
                disabled={testResult.status === 'testing'}
                className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-cyan-300 font-bold active:scale-95 transition-all text-xs shrink-0"
              >
                {testResult.status === 'testing' ? 'Pinging...' : 'Test Ping'}
              </button>
            </div>
            {testResult.status === 'success' && (
              <p className="flex items-center gap-1 text-[11px] text-emerald-400 mt-1 font-mono">
                <CheckCircle className="w-3.5 h-3.5" /> {testResult.message}
              </p>
            )}
            {testResult.status === 'failed' && (
              <p className="flex items-center gap-1 text-[11px] text-rose-400 mt-1 font-mono">
                <AlertTriangle className="w-3.5 h-3.5" /> {testResult.message}
              </p>
            )}
          </div>

          {/* Camera Stream URL */}
          <div>
            <label className="block text-slate-300 font-semibold mb-1 flex items-center gap-1.5">
              <Video className="w-4 h-4 text-cyan-400" />
              Camera MJPEG Stream URL
            </label>
            <input
              type="text"
              value={formData.cameraStreamUrl}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, cameraStreamUrl: e.target.value }))
              }
              placeholder="http://192.168.4.1:81/stream"
              className="w-full bg-slate-900 border border-slate-800 focus:border-cyan-400 px-3 py-2 rounded-lg text-slate-100 font-mono text-xs focus:outline-none"
            />
          </div>

          {/* Hold to Drive Toggle */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-slate-900/80 border border-slate-800">
            <div>
              <span className="font-bold text-slate-200">Hold to Drive Control</span>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Automatically sends STOP (&apos;S&apos;) when finger or mouse releases the drive button.
              </p>
            </div>
            <input
              type="checkbox"
              checked={formData.holdToDrive}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, holdToDrive: e.target.checked }))
              }
              className="w-5 h-5 rounded bg-slate-950 border-slate-700 accent-cyan-400 cursor-pointer"
            />
          </div>

          {/* Telemetry Polling Rate */}
          <div>
            <label className="block text-slate-300 font-semibold mb-1">
              Telemetry Polling Frequency
            </label>
            <select
              value={formData.pollIntervalMs}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  pollIntervalMs: parseInt(e.target.value, 10),
                }))
              }
              className="w-full bg-slate-900 border border-slate-800 focus:border-cyan-400 px-3 py-2 rounded-lg text-slate-100 font-mono text-xs focus:outline-none"
            >
              <option value={500}>Fast (Every 500 ms) - High Responsiveness</option>
              <option value={1000}>Normal (Every 1000 ms) - Recommended</option>
              <option value={2000}>Conservative (Every 2000 ms) - Low Traffic</option>
            </select>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 bg-slate-900 border-t border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-mono text-xs font-semibold"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-5 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-mono text-xs font-bold shadow-md shadow-cyan-950 active:scale-95 transition-all"
          >
            Save & Apply
          </button>
        </div>
      </div>
    </div>
  );
};
