'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Square,
  Navigation,
} from 'lucide-react';
import { DriveCommand } from '@/types/robot';

interface DrivePadProps {
  onSendCommand: (command: DriveCommand) => void;
  holdToDrive: boolean;
  disabled?: boolean;
}

export const DrivePad: React.FC<DrivePadProps> = ({
  onSendCommand,
  holdToDrive,
  disabled = false,
}) => {
  const [activeCommand, setActiveCommand] = useState<DriveCommand | null>(null);
  const activeCommandRef = useRef<DriveCommand | null>(null);

  const triggerDrive = useCallback(
    (cmd: DriveCommand) => {
      if (disabled) return;
      activeCommandRef.current = cmd;
      setActiveCommand(cmd);
      onSendCommand(cmd);
    },
    [disabled, onSendCommand]
  );

  const releaseDrive = useCallback(() => {
    if (disabled) return;
    if (holdToDrive && activeCommandRef.current !== null) {
      activeCommandRef.current = null;
      setActiveCommand(null);
      onSendCommand('S');
    }
  }, [disabled, holdToDrive, onSendCommand]);

  // Handle keyboard arrow & WASD bindings
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (disabled) return;
      // Ignore if user is currently typing in an input or textarea
      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA'
      ) {
        return;
      }

      let cmd: DriveCommand | null = null;
      if (e.key === 'ArrowUp' || e.key.toLowerCase() === 'w') cmd = 'F';
      else if (e.key === 'ArrowDown' || e.key.toLowerCase() === 's') cmd = 'B';
      else if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'a') cmd = 'L';
      else if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'd') cmd = 'R';
      else if (e.key === ' ' || e.key.toLowerCase() === 'x') cmd = 'S';

      if (cmd) {
        e.preventDefault();
        if (activeCommandRef.current !== cmd) {
          triggerDrive(cmd);
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (disabled) return;
      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA'
      ) {
        return;
      }

      if (holdToDrive) {
        const keys = ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'];
        if (keys.includes(e.key.toLowerCase())) {
          e.preventDefault();
          releaseDrive();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [disabled, holdToDrive, triggerDrive, releaseDrive]);

  // Props helper for buttons supporting both Mouse and Touch
  const getButtonProps = (cmd: DriveCommand) => {
    return {
      onMouseDown: (e: React.MouseEvent) => {
        e.preventDefault();
        if (holdToDrive) {
          triggerDrive(cmd);
        }
      },
      onMouseUp: (e: React.MouseEvent) => {
        e.preventDefault();
        if (holdToDrive) {
          releaseDrive();
        }
      },
      onMouseLeave: () => {
        if (holdToDrive && activeCommand === cmd) {
          releaseDrive();
        }
      },
      onTouchStart: (e: React.TouchEvent) => {
        e.preventDefault();
        if (holdToDrive) {
          triggerDrive(cmd);
        }
      },
      onTouchEnd: (e: React.TouchEvent) => {
        e.preventDefault();
        if (holdToDrive) {
          releaseDrive();
        }
      },
      onClick: (e: React.MouseEvent) => {
        e.preventDefault();
        if (!holdToDrive) {
          triggerDrive(cmd);
        } else if (activeCommandRef.current === null) {
          // Fallback if browser bypassed mousedown/mouseup: send bounded 600ms pulse
          triggerDrive(cmd);
          setTimeout(() => releaseDrive(), 600);
        }
      },
    };
  };

  return (
    <div className="flex flex-col items-center justify-center p-4 rounded-xl bg-slate-950/80 border border-cyan-500/25 shadow-xl select-none">
      <div className="flex items-center justify-between w-full mb-3">
        <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
          <Navigation className="w-3.5 h-3.5 text-cyan-400" />
          Drive Controller
        </span>
        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400">
          {holdToDrive ? 'HOLD TO DRIVE' : 'CLICK TO TOGGLE'}
        </span>
      </div>

      {/* Cross D-Pad Grid */}
      <div className="grid grid-cols-3 gap-2 w-48 h-48 sm:w-56 sm:h-56 p-2 bg-slate-900/60 rounded-2xl border border-slate-800 shadow-inner">
        {/* Top Empty */}
        <div />

        {/* Forward Button */}
        <button
          {...getButtonProps('F')}
          disabled={disabled}
          className={`flex flex-col items-center justify-center rounded-xl font-mono transition-all active:scale-95 shadow-md ${
            activeCommand === 'F'
              ? 'bg-cyan-500 text-slate-950 shadow-cyan-500/50 glow-cyan'
              : 'bg-slate-800 hover:bg-slate-700 text-cyan-400 border border-cyan-500/30'
          }`}
          aria-label="Drive Forward (F)"
        >
          <ArrowUp className="w-7 h-7 sm:w-8 sm:h-8" />
          <span className="text-[10px] font-bold mt-0.5">FWD [W]</span>
        </button>

        {/* Top-Right Empty */}
        <div />

        {/* Turn Left Button */}
        <button
          {...getButtonProps('L')}
          disabled={disabled}
          className={`flex flex-col items-center justify-center rounded-xl font-mono transition-all active:scale-95 shadow-md ${
            activeCommand === 'L'
              ? 'bg-cyan-500 text-slate-950 shadow-cyan-500/50 glow-cyan'
              : 'bg-slate-800 hover:bg-slate-700 text-cyan-400 border border-cyan-500/30'
          }`}
          aria-label="Turn Left (L)"
        >
          <ArrowLeft className="w-7 h-7 sm:w-8 sm:h-8" />
          <span className="text-[10px] font-bold mt-0.5">LEFT [A]</span>
        </button>

        {/* Center STOP Button */}
        <button
          onClick={(e) => {
            e.preventDefault();
            triggerDrive('S');
            activeCommandRef.current = null;
            setActiveCommand(null);
          }}
          disabled={disabled}
          className="flex flex-col items-center justify-center rounded-xl bg-gradient-to-br from-rose-700 to-red-800 hover:from-rose-600 hover:to-red-700 text-white font-mono transition-all active:scale-95 shadow-lg shadow-rose-950 border border-rose-400/50"
          aria-label="Stop Movement (S)"
        >
          <Square className="w-6 h-6 fill-white" />
          <span className="text-[10px] font-bold mt-0.5">STOP [S]</span>
        </button>

        {/* Turn Right Button */}
        <button
          {...getButtonProps('R')}
          disabled={disabled}
          className={`flex flex-col items-center justify-center rounded-xl font-mono transition-all active:scale-95 shadow-md ${
            activeCommand === 'R'
              ? 'bg-cyan-500 text-slate-950 shadow-cyan-500/50 glow-cyan'
              : 'bg-slate-800 hover:bg-slate-700 text-cyan-400 border border-cyan-500/30'
          }`}
          aria-label="Turn Right (R)"
        >
          <ArrowRight className="w-7 h-7 sm:w-8 sm:h-8" />
          <span className="text-[10px] font-bold mt-0.5">RIGHT [D]</span>
        </button>

        {/* Bottom-Left Empty */}
        <div />

        {/* Backward Button */}
        <button
          {...getButtonProps('B')}
          disabled={disabled}
          className={`flex flex-col items-center justify-center rounded-xl font-mono transition-all active:scale-95 shadow-md ${
            activeCommand === 'B'
              ? 'bg-cyan-500 text-slate-950 shadow-cyan-500/50 glow-cyan'
              : 'bg-slate-800 hover:bg-slate-700 text-cyan-400 border border-cyan-500/30'
          }`}
          aria-label="Drive Backward (B)"
        >
          <ArrowDown className="w-7 h-7 sm:w-8 sm:h-8" />
          <span className="text-[10px] font-bold mt-0.5">REV [S]</span>
        </button>

        {/* Bottom-Right Empty */}
        <div />
      </div>

      {/* Helpful keyboard shortcut hints */}
      <p className="text-[10px] text-slate-500 font-mono mt-3">
        Keyboard: WASD / Arrows to Drive • Spacebar to Stop
      </p>
    </div>
  );
};
