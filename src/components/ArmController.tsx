'use client';

import React from 'react';
import { ArmJoint, ArmAngles, ARM_PRESETS, ArmPosePreset } from '@/types/robot';
import { Wrench, Layers, RotateCcw } from 'lucide-react';

interface ArmControllerProps {
  armAngles: ArmAngles;
  onSetJointAngle: (joint: ArmJoint, angle: number) => void;
  onApplyPreset: (preset: ArmPosePreset) => void;
  disabled?: boolean;
}

export const ArmController: React.FC<ArmControllerProps> = ({
  armAngles,
  onSetJointAngle,
  onApplyPreset,
  disabled = false,
}) => {
  const joints: { key: ArmJoint; label: string; min: number; max: number; desc: string }[] = [
    { key: 'BASE', label: 'Base (Yaw)', min: 0, max: 180, desc: 'Rotation 0° (Right) - 180° (Left)' },
    { key: 'SHOULDER', label: 'Shoulder (Pitch)', min: 0, max: 180, desc: 'Arm elevation angle' },
    { key: 'ELBOW', label: 'Elbow (Flex)', min: 0, max: 180, desc: 'Forearm articulation' },
    { key: 'GRIPPER', label: 'Gripper (Clamp)', min: 0, max: 180, desc: '0° (Clamp Closed) - 180° (Full Open)' },
  ];

  return (
    <div className="flex flex-col p-4 rounded-xl bg-slate-950/80 border border-cyan-500/25 shadow-xl">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
          <Wrench className="w-3.5 h-3.5 text-cyan-400" />
          4-DOF Robotic Arm (Nano Serial Bridge)
        </span>
        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400">
          SG90 SERVOS
        </span>
      </div>

      {/* Visual Arm Kinematic Schematic Preview (SVG) */}
      <div className="relative w-full h-28 bg-slate-900/60 rounded-lg border border-slate-800/80 mb-3 flex items-center justify-center overflow-hidden">
        <svg
          viewBox="0 0 240 100"
          className="w-full h-full p-2"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Base plate */}
          <rect x="30" y="82" width="40" height="8" rx="2" fill="#334155" />
          {/* Base rotation indicator */}
          <circle cx="50" cy="82" r="5" fill="#00f0ff" />

          {/* Dynamic kinematic joints calculation */}
          {(() => {
            const baseX = 50;
            const baseY = 82;
            const len1 = 35; // Shoulder to elbow length
            const len2 = 32; // Elbow to wrist length
            const len3 = 18; // Wrist to gripper length

            // Transform degrees to radians (shoulder: 0=down, 90=straight, etc)
            const radShoulder = ((180 - armAngles.SHOULDER) * Math.PI) / 180;
            const joint1X = baseX + Math.cos(radShoulder) * len1;
            const joint1Y = baseY - Math.sin(radShoulder) * len1;

            const radElbow = radShoulder + ((armAngles.ELBOW - 90) * Math.PI) / 180;
            const joint2X = joint1X + Math.cos(radElbow) * len2;
            const joint2Y = joint1Y - Math.sin(radElbow) * len2;

            const radGripper = radElbow + 0.1;
            const joint3X = joint2X + Math.cos(radGripper) * len3;
            const joint3Y = joint2Y - Math.sin(radGripper) * len3;

            return (
              <g>
                {/* Arm Segment 1: Base to Shoulder */}
                <line
                  x1={baseX}
                  y1={baseY}
                  x2={joint1X}
                  y2={joint1Y}
                  stroke="#38bdf8"
                  strokeWidth="5"
                  strokeLinecap="round"
                />
                {/* Joint 1 */}
                <circle cx={joint1X} cy={joint1Y} r="4" fill="#0284c7" stroke="#38bdf8" strokeWidth="1.5" />

                {/* Arm Segment 2: Shoulder to Elbow */}
                <line
                  x1={joint1X}
                  y1={joint1Y}
                  x2={joint2X}
                  y2={joint2Y}
                  stroke="#818cf8"
                  strokeWidth="4"
                  strokeLinecap="round"
                />
                {/* Joint 2 */}
                <circle cx={joint2X} cy={joint2Y} r="3.5" fill="#6366f1" stroke="#a5b4fc" strokeWidth="1.5" />

                {/* Gripper clamp */}
                <line
                  x1={joint2X}
                  y1={joint2Y}
                  x2={joint3X}
                  y2={joint3Y}
                  stroke="#f43f5e"
                  strokeWidth="3"
                  strokeLinecap="round"
                />
                <circle cx={joint3X} cy={joint3Y} r="2.5" fill="#f43f5e" />
              </g>
            );
          })()}

          {/* Telemetry text on SVG */}
          <text x="140" y="24" fill="#94a3b8" fontSize="9" fontFamily="monospace">
            B: {armAngles.BASE}° | S: {armAngles.SHOULDER}°
          </text>
          <text x="140" y="38" fill="#94a3b8" fontSize="9" fontFamily="monospace">
            E: {armAngles.ELBOW}° | G: {armAngles.GRIPPER}°
          </text>
        </svg>
      </div>

      {/* Preset Poses Row */}
      <div className="mb-4">
        <div className="flex items-center gap-1 text-[11px] font-mono text-slate-400 mb-1.5">
          <Layers className="w-3 h-3 text-cyan-400" />
          <span>Quick Poses:</span>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
          {ARM_PRESETS.map((preset) => (
            <button
              key={preset.name}
              onClick={() => onApplyPreset(preset)}
              disabled={disabled}
              className="px-2 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-cyan-500/40 text-[10px] font-mono text-slate-300 hover:text-cyan-300 transition-all active:scale-95 text-center"
              title={preset.description}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* Joint Sliders */}
      <div className="space-y-3">
        {joints.map(({ key, label, min, max, desc }) => {
          const currentAngle = armAngles[key];
          return (
            <div key={key} className="p-2 rounded-lg bg-slate-900/60 border border-slate-800/80">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-mono font-medium text-slate-200">
                  {label}
                </span>
                <span className="text-xs font-mono font-bold text-cyan-400">
                  {currentAngle}°
                </span>
              </div>
              <input
                type="range"
                min={min}
                max={max}
                value={currentAngle}
                disabled={disabled}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  onSetJointAngle(key, val);
                }}
                className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400"
              />
              <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono mt-0.5">
                <span>{min}°</span>
                <span className="truncate max-w-[150px]">{desc}</span>
                <span>{max}°</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Gripper Fast Action Buttons */}
      <div className="grid grid-cols-2 gap-2 mt-3 pt-2 border-t border-slate-800">
        <button
          onClick={() => onSetJointAngle('GRIPPER', 10)}
          disabled={disabled}
          className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-rose-500/30 text-rose-300 font-mono text-xs font-semibold active:scale-95 transition-all text-center"
        >
          Clamp Gripper (10°)
        </button>
        <button
          onClick={() => onSetJointAngle('GRIPPER', 100)}
          disabled={disabled}
          className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-cyan-500/30 text-cyan-300 font-mono text-xs font-semibold active:scale-95 transition-all text-center"
        >
          Open Gripper (100°)
        </button>
      </div>
    </div>
  );
};
