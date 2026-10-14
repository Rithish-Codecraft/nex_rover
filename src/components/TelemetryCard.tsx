'use client';

import React from 'react';
import {
  Radar,
  AlertTriangle,
  BatteryCharging,
  Battery,
  Activity,
  Cpu,
  Clock,
  Radio,
} from 'lucide-react';
import { TelemetryData } from '@/types/robot';

interface TelemetryCardProps {
  telemetry: TelemetryData;
}

export const TelemetryCard: React.FC<TelemetryCardProps> = ({ telemetry }) => {
  const hasObstacle = telemetry.obstacleDistanceCm !== null;
  const isObstacleCritical = hasObstacle && (telemetry.obstacleDistanceCm as number) < 20;
  const isObstacleWarning =
    hasObstacle &&
    (telemetry.obstacleDistanceCm as number) >= 20 &&
    (telemetry.obstacleDistanceCm as number) < 40;

  return (
    <div className="flex flex-col p-4 rounded-xl bg-slate-950/80 border border-cyan-500/25 shadow-xl">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
          <Activity className="w-3.5 h-3.5 text-cyan-400" />
          Sensor Telemetry & Diagnostics
        </span>
        {telemetry.isSimulated && (
          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/30">
            SIMULATED FEED
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* HC-SR04 Ultrasonic Sonar Obstacle Detector */}
        <div
          className={`p-3 rounded-lg border transition-all ${
            isObstacleCritical
              ? 'bg-rose-950/60 border-rose-500/60'
              : isObstacleWarning
              ? 'bg-amber-950/40 border-amber-500/50'
              : 'bg-slate-900/60 border-slate-800'
          }`}
        >
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-mono text-slate-400 flex items-center gap-1.5">
              <Radar
                className={`w-4 h-4 ${
                  isObstacleCritical
                    ? 'text-rose-400 animate-spin'
                    : hasObstacle
                    ? 'text-cyan-400'
                    : 'text-slate-500'
                }`}
              />
              Sonar Proximity (HC-SR04)
            </span>
            {isObstacleCritical && (
              <span className="flex items-center gap-1 text-[10px] font-mono font-bold text-rose-400 animate-pulse">
                <AlertTriangle className="w-3 h-3" /> PROXIMITY ALERT
              </span>
            )}
          </div>

          {hasObstacle ? (
            <div className="space-y-2">
              <div className="flex items-baseline gap-2">
                <span
                  className={`text-2xl font-bold font-mono ${
                    isObstacleCritical
                      ? 'text-rose-400'
                      : isObstacleWarning
                      ? 'text-amber-400'
                      : 'text-cyan-300'
                  }`}
                >
                  {telemetry.obstacleDistanceCm}
                </span>
                <span className="text-xs font-mono text-slate-400">cm to obstacle</span>
              </div>

              {/* Progress bar visualizer */}
              <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                <div
                  className={`h-2 rounded-full transition-all duration-300 ${
                    isObstacleCritical
                      ? 'bg-rose-500'
                      : isObstacleWarning
                      ? 'bg-amber-400'
                      : 'bg-cyan-400'
                  }`}
                  style={{
                    width: `${Math.min(100, Math.max(5, (telemetry.obstacleDistanceCm as number) / 1.5))}%`,
                  }}
                />
              </div>
            </div>
          ) : (
            <div className="py-2 text-center">
              <p className="text-xs font-mono text-slate-500">
                Telemetry Unavailable
              </p>
              <p className="text-[10px] font-mono text-slate-600 mt-0.5">
                (Sonar HC-SR04 not broadcasting on UNO pin 12/13)
              </p>
            </div>
          )}
        </div>

        {/* Battery Telemetry */}
        <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-800">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-mono text-slate-400 flex items-center gap-1.5">
              {telemetry.batteryVoltage !== null ? (
                <BatteryCharging className="w-4 h-4 text-emerald-400" />
              ) : (
                <Battery className="w-4 h-4 text-slate-500" />
              )}
              Battery Pack (2S Li-ion)
            </span>
          </div>

          {telemetry.batteryVoltage !== null ? (
            <div className="space-y-1">
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold font-mono text-emerald-400">
                  {telemetry.batteryVoltage}
                </span>
                <span className="text-xs font-mono text-slate-400">Volts DC</span>
              </div>
              <p className="text-[10px] font-mono text-slate-500">
                Nominal 7.4V (Safe range: 6.8V - 8.4V)
              </p>
            </div>
          ) : (
            <div className="py-2 text-center">
              <p className="text-xs font-mono text-slate-500">
                Voltage Unavailable
              </p>
              <p className="text-[10px] font-mono text-slate-600 mt-0.5">
                (No voltage divider telemetry connected to A0)
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Hardware Bridge Diagnostics Info */}
      <div className="mt-3 pt-3 border-t border-slate-900 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono text-slate-400">
        <div className="flex items-center gap-1">
          <Cpu className="w-3 h-3 text-cyan-400" />
          <span>UNO: L293D Bridge</span>
        </div>
        <div className="flex items-center gap-1">
          <Radio className="w-3 h-3 text-cyan-400" />
          <span>Nano: Arm Bridge</span>
        </div>
        <div className="flex items-center gap-1">
          <Clock className="w-3 h-3 text-cyan-400" />
          <span>Last Cmd: {telemetry.lastCommand || 'None'}</span>
        </div>
        <div className="flex items-center gap-1 text-right">
          <span>Firmware: {telemetry.firmwareVersion || 'Unknown'}</span>
        </div>
      </div>
    </div>
  );
};
