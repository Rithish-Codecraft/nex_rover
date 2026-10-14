'use client';

import React from 'react';
import {
  Wifi,
  WifiOff,
  Battery,
  BatteryCharging,
  AlertOctagon,
  Settings,
  Cpu,
  Radio,
} from 'lucide-react';
import { TelemetryData } from '@/types/robot';

interface HeaderProps {
  telemetry: TelemetryData;
  isSimulated: boolean;
  onOpenSettings: () => void;
  onEmergencyStop: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  telemetry,
  isSimulated,
  onOpenSettings,
  onEmergencyStop,
}) => {
  const isOnline = telemetry.connected;

  return (
    <header className="sticky top-0 z-40 bg-slate-950/85 backdrop-blur-md border-b border-cyan-500/20 px-3 py-2.5 sm:px-6">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-2">
        {/* Logo and Rover Identity */}
        <div className="flex items-center gap-2.5">
          <div className="relative flex items-center justify-center w-9 h-9 rounded-lg bg-gradient-to-br from-cyan-500/20 to-blue-600/30 border border-cyan-400/40 text-cyan-300">
            <Radio className="w-5 h-5 animate-pulse" />
            <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
              <span
                className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                  isOnline ? (isSimulated ? 'bg-amber-400' : 'bg-emerald-400') : 'bg-rose-500'
                }`}
              />
              <span
                className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                  isOnline ? (isSimulated ? 'bg-amber-400' : 'bg-emerald-400') : 'bg-rose-500'
                }`}
              />
            </span>
          </div>

          <div>
            <div className="flex items-center gap-1.5">
              <h1 className="text-base sm:text-lg font-bold tracking-wider text-slate-100 flex items-center gap-1 font-mono">
                NEX<span className="text-cyan-400">-ROVER</span>
              </h1>
              {isSimulated ? (
                <span className="px-1.5 py-0.5 text-[10px] font-mono tracking-wide uppercase font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded">
                  Simulation
                </span>
              ) : (
                <span className="px-1.5 py-0.5 text-[10px] font-mono tracking-wide uppercase font-semibold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 rounded">
                  Hardware
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-400 font-mono hidden sm:block">
              4WD Mobile Rover + 4-DOF Robotic Arm
            </p>
          </div>
        </div>

        {/* Status Indicators & E-STOP */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Connection Status & Latency */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-900/90 border border-slate-800 text-xs font-mono">
            {isOnline ? (
              <>
                <Wifi className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-400 font-medium hidden xs:inline">ONLINE</span>
                {telemetry.latencyMs !== null && (
                  <span className="text-slate-400 text-[11px] border-l border-slate-700 pl-1.5">
                    {telemetry.latencyMs}ms
                  </span>
                )}
              </>
            ) : (
              <>
                <WifiOff className="w-3.5 h-3.5 text-rose-400" />
                <span className="text-rose-400 font-medium">DISCONNECTED</span>
              </>
            )}
          </div>

          {/* Battery Telemetry - only when actual telemetry is available */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-900/90 border border-slate-800 text-xs font-mono">
            {telemetry.batteryVoltage !== null ? (
              <>
                <BatteryCharging className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-slate-200 font-semibold">{telemetry.batteryVoltage}V</span>
              </>
            ) : (
              <>
                <Battery className="w-3.5 h-3.5 text-slate-500" />
                <span className="text-slate-500 text-[11px]">BATT N/A</span>
              </>
            )}
          </div>

          {/* Settings Modal Toggle */}
          <button
            onClick={onOpenSettings}
            title="Configure Robot IP & Settings"
            className="p-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700/80 text-slate-300 hover:text-cyan-300 transition-colors active:scale-95"
            aria-label="Settings"
          >
            <Settings className="w-4 h-4" />
          </button>

          {/* Prominent Emergency STOP Button */}
          <button
            onClick={onEmergencyStop}
            className="flex items-center gap-1.5 px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white font-bold text-xs sm:text-sm tracking-wider uppercase shadow-lg shadow-red-950/50 border border-rose-400/50 active:scale-95 transition-all glow-red"
            title="IMMEDIATE EMERGENCY STOP (Halt all motors & arm)"
          >
            <AlertOctagon className="w-4 h-4 text-white animate-pulse" />
            <span>E-STOP</span>
          </button>
        </div>
      </div>
    </header>
  );
};
