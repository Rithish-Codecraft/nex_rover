'use client';

import React, { useState } from 'react';
import { Gauge, Zap } from 'lucide-react';

interface MotorSpeedControlProps {
  currentSpeed: number;
  onSetSpeed: (speed: number) => void;
  disabled?: boolean;
}

export const MotorSpeedControl: React.FC<MotorSpeedControlProps> = ({
  currentSpeed,
  onSetSpeed,
  disabled = false,
}) => {
  const [speed, setSpeed] = useState<number>(currentSpeed || 160);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
    setSpeed(val);
  };

  const handleCommit = () => {
    onSetSpeed(speed);
  };

  const handlePreset = (presetValue: number) => {
    setSpeed(presetValue);
    onSetSpeed(presetValue);
  };

  const speedPercent = Math.round((speed / 255) * 100);

  return (
    <div className="flex flex-col p-4 rounded-xl bg-slate-950/80 border border-cyan-500/25 shadow-xl">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
          <Gauge className="w-3.5 h-3.5 text-cyan-400" />
          PWM Motor Throttle
        </span>
        <div className="flex items-center gap-1 font-mono text-xs">
          <span className="text-cyan-400 font-bold text-sm">{speed}</span>
          <span className="text-slate-500">/ 255</span>
          <span className="text-[11px] text-cyan-300/80 ml-1">({speedPercent}%)</span>
        </div>
      </div>

      {/* Speed Slider */}
      <div className="relative flex items-center py-2">
        <input
          type="range"
          min="0"
          max="255"
          step="5"
          value={speed}
          disabled={disabled}
          onChange={handleChange}
          onMouseUp={handleCommit}
          onTouchEnd={handleCommit}
          className="w-full h-2.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400"
        />
      </div>

      {/* Preset Quick Buttons */}
      <div className="grid grid-cols-3 gap-2 mt-2">
        <button
          onClick={() => handlePreset(90)}
          disabled={disabled}
          className={`px-2 py-1.5 rounded-lg font-mono text-[11px] font-semibold transition-all border ${
            speed === 90
              ? 'bg-cyan-500/20 text-cyan-300 border-cyan-400/50'
              : 'bg-slate-900 hover:bg-slate-800 text-slate-400 border-slate-800'
          }`}
        >
          Crawl (90)
        </button>
        <button
          onClick={() => handlePreset(160)}
          disabled={disabled}
          className={`px-2 py-1.5 rounded-lg font-mono text-[11px] font-semibold transition-all border ${
            speed === 160
              ? 'bg-cyan-500/20 text-cyan-300 border-cyan-400/50'
              : 'bg-slate-900 hover:bg-slate-800 text-slate-400 border-slate-800'
          }`}
        >
          Cruise (160)
        </button>
        <button
          onClick={() => handlePreset(255)}
          disabled={disabled}
          className={`flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg font-mono text-[11px] font-semibold transition-all border ${
            speed === 255
              ? 'bg-amber-500/20 text-amber-300 border-amber-400/50 glow-amber'
              : 'bg-slate-900 hover:bg-slate-800 text-slate-400 border-slate-800'
          }`}
        >
          <Zap className="w-3 h-3 text-amber-400" />
          Turbo (255)
        </button>
      </div>
    </div>
  );
};
