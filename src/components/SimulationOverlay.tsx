'use client';

import React from 'react';
import { FlaskConical, AlertTriangle, ShieldCheck, RefreshCw } from 'lucide-react';
import { simulationEngine } from '@/lib/robot-api';

interface SimulationBannerProps {
  onToggleHardware: () => void;
}

export const SimulationBanner: React.FC<SimulationBannerProps> = ({ onToggleHardware }) => {
  return (
    <div className="bg-gradient-to-r from-amber-950/70 via-slate-900 to-amber-950/70 border-b border-amber-500/30 px-3 py-1.5 text-xs font-mono text-amber-300">
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <FlaskConical className="w-4 h-4 text-amber-400 animate-pulse" />
          <span className="font-bold">SIMULATION / DEMO MODE ACTIVE</span>
          <span className="text-slate-400 hidden md:inline">
            — Virtual motors, arm kinematic kinematics, and obstacle telemetry active for testing without physical hardware.
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => simulationEngine.resetObstacle(15)}
            className="px-2 py-0.5 rounded bg-rose-950/60 hover:bg-rose-900/80 border border-rose-500/40 text-[10px] text-rose-300 active:scale-95"
            title="Set simulated obstacle to 15cm to test proximity alert"
          >
            Trigger 15cm Warning
          </button>
          <button
            onClick={() => simulationEngine.resetObstacle(70)}
            className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[10px] text-slate-300 active:scale-95"
            title="Clear simulated obstacle distance"
          >
            Clear Path (70cm)
          </button>
          <button
            onClick={onToggleHardware}
            className="px-2.5 py-0.5 rounded bg-cyan-600/30 hover:bg-cyan-600/50 border border-cyan-400/40 text-[10px] font-bold text-cyan-200 active:scale-95"
          >
            Switch to Hardware
          </button>
        </div>
      </div>
    </div>
  );
};
