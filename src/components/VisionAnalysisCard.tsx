'use client';

import React, { useState } from 'react';
import {
  Sparkles,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Play,
  RotateCcw,
  AlertOctagon,
  Eye,
  Camera,
  Cpu,
  Layers,
  ArrowRight,
} from 'lucide-react';
import {
  CapturedFrame,
  GeminiVisionRecommendation,
  VisionAnalysisResult,
  RelayCommandResult,
  RobotSettings,
  ApprovalState,
  RoverControlMode,
} from '@/types/robot';

interface VisionAnalysisCardProps {
  capturedFrame: CapturedFrame | null;
  onClearFrame: () => void;
  settings: RobotSettings;
  onEmergencyStop: () => void;
  onExecutionFinished?: (cmd: string) => void;
  controlMode?: RoverControlMode;
}

export const VisionAnalysisCard: React.FC<VisionAnalysisCardProps> = ({
  capturedFrame,
  onClearFrame,
  settings,
  onEmergencyStop,
  onExecutionFinished,
  controlMode = 'approval',
}) => {
  const [taskPrompt, setTaskPrompt] = useState<string>(
    'Inspect path for obstacles and suggest safe rover navigation'
  );
  const [approvalState, setApprovalState] = useState<ApprovalState>('idle');
  const [analysisResult, setAnalysisResult] = useState<VisionAnalysisResult | null>(null);
  const [executionResult, setExecutionResult] = useState<RelayCommandResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const quickPrompts = [
    'Check if path ahead is clear',
    'Detect obstacles and suggest detour',
    'Find object for robotic arm to grab',
    'Inspect floor terrain for drop-offs',
  ];

  // Trigger Gemini Vision Analysis on server endpoint /api/vision
  const handleAnalyze = async () => {
    if (!capturedFrame) return;

    setApprovalState('analyzing');
    setErrorMessage(null);
    setAnalysisResult(null);
    setExecutionResult(null);

    try {
      const res = await fetch('/api/vision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: capturedFrame.dataUrl,
          task: taskPrompt,
        }),
      });

      const data: VisionAnalysisResult = await res.json();

      if (!res.ok || !data.ok || !data.recommendation) {
        throw new Error(data.error || 'Failed to analyze frame with Gemini Vision');
      }

      setAnalysisResult(data);
      setApprovalState('recommendation_ready');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Analysis failed';
      setErrorMessage(msg);
      setApprovalState('failed');
    }
  };

  // Operator Approves Action: Sends command through relay endpoint /api/relay
  const handleApproveAction = async () => {
    if (!analysisResult?.recommendation) return;

    const rec = analysisResult.recommendation;
    setApprovalState('approving');
    setErrorMessage(null);

    try {
      const res = await fetch('/api/relay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: rec.recommendedAction,
          armAction: rec.armAction,
          speed: rec.speed,
          durationMs: rec.durationMs,
          pcBackendUrl: settings.pcBackendUrl,
          roverToken: settings.roverToken,
          robotIp: settings.robotIp,
          usePcRelay: settings.usePcRelay,
          isSimulated: settings.isSimulated,
        }),
      });

      const result: RelayCommandResult = await res.json();

      if (!res.ok || !result.ok) {
        throw new Error(result.error || 'Relay failed to dispatch command');
      }

      setExecutionResult(result);
      setApprovalState('executed');

      // If duration is specified for a drive action, schedule auto-stop after duration
      if (['FORWARD', 'BACKWARD', 'LEFT', 'RIGHT'].includes(rec.recommendedAction) && rec.durationMs > 0) {
        setTimeout(async () => {
          await fetch('/api/relay', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'STOP',
              pcBackendUrl: settings.pcBackendUrl,
              roverToken: settings.roverToken,
              robotIp: settings.robotIp,
              usePcRelay: settings.usePcRelay,
              isSimulated: settings.isSimulated,
            }),
          }).catch(() => {});
        }, rec.durationMs);
      }

      if (onExecutionFinished && result.commandSent) {
        onExecutionFinished(result.commandSent);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Execution failed';
      setErrorMessage(msg);
      setApprovalState('failed');
    }
  };

  // Operator Rejects Action
  const handleRejectAction = () => {
    setApprovalState('rejected');
  };

  // Reset to analyze another frame
  const handleReset = () => {
    setApprovalState('idle');
    setAnalysisResult(null);
    setExecutionResult(null);
    setErrorMessage(null);
    onClearFrame();
  };

  const rec = analysisResult?.recommendation;

  return (
    <div className="flex flex-col rounded-xl bg-slate-950/85 border border-cyan-500/30 shadow-2xl overflow-hidden font-mono text-xs">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-slate-900/90 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-cyan-400" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-100 flex items-center gap-1.5">
            Gemini Vision AI <span className="text-slate-500">•</span>{' '}
            <span
              className={
                controlMode === 'autonomous'
                  ? 'text-purple-400'
                  : controlMode === 'approval'
                  ? 'text-amber-400'
                  : 'text-cyan-400'
              }
            >
              {controlMode === 'autonomous' ? 'Autonomous Mode' : controlMode === 'approval' ? 'Approval Gate' : 'Manual Mode'}
            </span>
          </h3>
        </div>

        <div className="flex items-center gap-2">
          {settings.usePcRelay && (
            <span className="hidden sm:inline px-2 py-0.5 rounded text-[10px] bg-slate-800 border border-slate-700 text-slate-300">
              Relay: PC Backend
            </span>
          )}
          <span className="px-2 py-0.5 rounded text-[10px] bg-cyan-500/10 text-cyan-400 border border-cyan-500/30">
            Mobile Cam Source
          </span>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Task Prompt Input */}
        <div>
          <label className="block text-slate-300 font-semibold mb-1 text-[11px]">
            Operator Mission / Inspection Task:
          </label>
          <input
            type="text"
            value={taskPrompt}
            onChange={(e) => setTaskPrompt(e.target.value)}
            disabled={approvalState === 'analyzing' || approvalState === 'approving'}
            placeholder="e.g. Check for stairs or blocks ahead..."
            className="w-full bg-slate-900 border border-slate-800 focus:border-cyan-400 px-3 py-2 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none text-xs"
          />

          {/* Quick task pills */}
          <div className="flex items-center gap-1.5 mt-1.5 overflow-x-auto no-scrollbar">
            {quickPrompts.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => setTaskPrompt(q)}
                className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[10px] text-slate-400 hover:text-cyan-300 whitespace-nowrap"
              >
                {q}
              </button>
            ))}
          </div>
        </div>

        {/* Captured Frame Status / Thumbnail */}
        <div className="flex items-center justify-between p-3 rounded-lg bg-slate-900/60 border border-slate-800">
          <div className="flex items-center gap-3">
            {capturedFrame ? (
              <div className="relative w-16 h-12 rounded bg-black overflow-hidden border border-cyan-500/40 shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={capturedFrame.dataUrl}
                  alt="Captured Frame Preview"
                  className="w-full h-full object-cover"
                />
              </div>
            ) : (
              <div className="w-16 h-12 rounded bg-slate-950 border border-slate-800 flex items-center justify-center text-slate-600 shrink-0">
                <Camera className="w-5 h-5" />
              </div>
            )}

            <div>
              <div className="font-bold text-slate-200">
                {capturedFrame ? 'Frame Captured from Rear Camera' : 'No Frame Captured Yet'}
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                {capturedFrame
                  ? `${capturedFrame.width}x${capturedFrame.height}px • Captured ${capturedFrame.timestamp}`
                  : 'Switch to "Phone Cam" tab above and tap "Capture Frame" to snapshot'}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {capturedFrame && (
              <button
                type="button"
                onClick={onClearFrame}
                className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 text-[11px]"
              >
                Clear
              </button>
            )}

            <button
              type="button"
              onClick={handleAnalyze}
              disabled={!capturedFrame || approvalState === 'analyzing' || approvalState === 'approving'}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 disabled:from-slate-800 disabled:to-slate-800 text-white disabled:text-slate-500 font-bold tracking-wide shadow-md shadow-cyan-950 active:scale-95 transition-all text-xs"
            >
              <Sparkles className="w-3.5 h-3.5" />
              {approvalState === 'analyzing' ? 'Analyzing...' : 'Analyze with Gemini'}
            </button>
          </div>
        </div>

        {/* Error Notification */}
        {errorMessage && (
          <div className="p-3 rounded-lg bg-rose-950/60 border border-rose-500/50 text-rose-300 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <div className="font-bold">Vision / Relay Error</div>
              <div className="text-[11px] mt-0.5 text-rose-200/90">{errorMessage}</div>
            </div>
          </div>
        )}

        {/* Gemini Vision Results & Recommendation Display */}
        {rec && (
          <div className="p-3.5 rounded-xl bg-slate-900 border border-cyan-500/30 space-y-3">
            {/* Scene Summary */}
            <div>
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                <Eye className="w-3.5 h-3.5 text-cyan-400" /> Scene Assessment
              </div>
              <p className="text-slate-200 text-xs leading-relaxed bg-slate-950/60 p-2.5 rounded border border-slate-800">
                {rec.sceneSummary}
              </p>
            </div>

            {/* Detected Objects & Hazards Badges */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <span className="text-[10px] text-slate-400 font-semibold block mb-1">
                  Detected Objects:
                </span>
                <div className="flex flex-wrap gap-1">
                  {rec.detectedObjects.length > 0 ? (
                    rec.detectedObjects.map((obj, i) => {
                      const isObj = typeof obj === 'object' && obj !== null;
                      const label = isObj ? (obj as any).label : String(obj);
                      const dir = isObj ? (obj as any).direction : 'front';
                      const dist = isObj ? (obj as any).distanceEstimate : 'unknown';
                      const conf = isObj && typeof (obj as any).confidence === 'number' ? Math.round((obj as any).confidence * 100) : null;
                      return (
                        <span
                          key={i}
                          className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px] border border-slate-700 flex items-center gap-1.5"
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                          <strong className="text-white">{label}</strong>
                          <span className="text-slate-500">({dir}{dist && dist !== 'unknown' ? ` • ${dist}` : ''})</span>
                          {conf !== null && <span className="text-cyan-400 text-[9px] font-bold">{conf}%</span>}
                        </span>
                      );
                    })
                  ) : (
                    <span className="text-[10px] text-slate-500">None detected</span>
                  )}
                </div>
              </div>

              <div>
                <span className="text-[10px] text-slate-400 font-semibold block mb-1">
                  Hazards & Constraints:
                </span>
                <div className="flex flex-wrap gap-1">
                  {rec.hazards.length > 0 ? (
                    rec.hazards.map((haz, i) => (
                      <span
                        key={i}
                        className="flex items-center gap-1 px-2 py-0.5 rounded bg-rose-950/60 text-rose-300 text-[10px] border border-rose-500/40 font-bold"
                      >
                        <AlertTriangle className="w-2.5 h-2.5 text-rose-400" />
                        {haz}
                      </span>
                    ))
                  ) : (
                    <span className="px-2 py-0.5 rounded bg-emerald-950/40 text-emerald-400 text-[10px] border border-emerald-500/30">
                      No immediate hazards flagged
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Recommended Action Card */}
            <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <div className="text-[10px] text-slate-400 uppercase tracking-wide">
                  Gemini Recommended Action:
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span
                    className={`text-base font-bold px-2.5 py-0.5 rounded font-mono ${
                      rec.recommendedAction === 'STOP'
                        ? 'bg-rose-600/30 text-rose-300 border border-rose-500/50'
                        : rec.recommendedAction === 'NO_ACTION'
                        ? 'bg-slate-800 text-slate-300 border border-slate-700'
                        : 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/50'
                    }`}
                  >
                    {rec.recommendedAction}
                  </span>

                  {rec.recommendedAction !== 'STOP' && rec.recommendedAction !== 'NO_ACTION' && (
                    <span className="text-[11px] text-slate-400">
                      Duration: {rec.durationMs}ms • Speed: {rec.speed}
                    </span>
                  )}

                  {rec.armAction && (
                    <span className="text-[11px] text-purple-300 font-semibold">
                      [{rec.armAction.joint}: {rec.armAction.angle}°]
                    </span>
                  )}
                </div>
              </div>

              {/* Confidence Gauge */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-400">Confidence:</span>
                <span className="text-xs font-bold text-cyan-300">
                  {Math.round(rec.confidence * 100)}%
                </span>
                <div className="w-16 bg-slate-800 rounded-full h-1.5 overflow-hidden">
                  <div
                    className="bg-cyan-400 h-1.5 rounded-full"
                    style={{ width: `${Math.round(rec.confidence * 100)}%` }}
                  />
                </div>
              </div>
            </div>

            {/* AI Reasoning */}
            <div className="text-[11px] text-slate-400 italic">
              &quot;{rec.reason}&quot;
            </div>

            {/* Operator Approval Interface */}
            {approvalState === 'recommendation_ready' && (
              <div className="p-3 rounded-lg bg-amber-950/40 border border-amber-500/40 flex flex-col sm:flex-row items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-amber-300">
                  <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0 animate-pulse" />
                  <div>
                    <div className="font-bold text-xs uppercase tracking-wider">
                      Operator Approval Required
                    </div>
                    <div className="text-[10px] text-slate-400">
                      Hardware movement will NOT execute without explicit authorization.
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <button
                    type="button"
                    onClick={handleRejectAction}
                    className="flex-1 sm:flex-initial flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-rose-300 border border-rose-500/30 text-xs font-bold active:scale-95 transition-all"
                  >
                    <XCircle className="w-4 h-4 text-rose-400" />
                    Reject
                  </button>

                  <button
                    type="button"
                    onClick={handleApproveAction}
                    className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-4 py-1.5 rounded-lg bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-500 hover:to-green-500 text-white text-xs font-bold shadow-md shadow-emerald-950 active:scale-95 transition-all glow-cyan"
                  >
                    <CheckCircle className="w-4 h-4" />
                    Approve & Execute
                  </button>
                </div>
              </div>
            )}

            {/* Executing Status */}
            {approvalState === 'approving' && (
              <div className="p-3 rounded-lg bg-cyan-950/40 border border-cyan-500/40 text-cyan-300 flex items-center gap-2">
                <Cpu className="w-4 h-4 animate-spin text-cyan-400" />
                <span>Transmitting approved command via authenticated relay...</span>
              </div>
            )}

            {/* Acknowledged Execution Result */}
            {approvalState === 'executed' && executionResult && (
              <div className="p-3 rounded-lg bg-emerald-950/40 border border-emerald-500/40 text-emerald-300 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-bold flex items-center gap-1.5">
                    <CheckCircle className="w-4 h-4 text-emerald-400" />
                    Action Executed & Confirmed
                  </span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-900/60 border border-emerald-700">
                    ACK: {executionResult.acknowledgedBy?.toUpperCase()}
                  </span>
                </div>
                <p className="text-[11px] text-slate-300">
                  Command <span className="font-bold text-white">[{executionResult.commandSent}]</span> successfully relayed to ESP32-CAM and Arduino UNO.
                </p>
                <div className="pt-2 flex justify-end">
                  <button
                    type="button"
                    onClick={handleReset}
                    className="flex items-center gap-1 px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px]"
                  >
                    <RotateCcw className="w-3 h-3" /> Inspect Next Frame
                  </button>
                </div>
              </div>
            )}

            {/* Rejected Status */}
            {approvalState === 'rejected' && (
              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-slate-400 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-rose-400">
                  <XCircle className="w-4 h-4" /> Action Rejected by Operator. Rover remained stationary.
                </span>
                <button
                  type="button"
                  onClick={handleReset}
                  className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px]"
                >
                  Reset
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Persistent Safety E-Stop Footer */}
      <div className="px-4 py-2 bg-slate-950 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-500">
        <span className="flex items-center gap-1">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          Hardware Level Safety Interlock Active
        </span>

        <button
          type="button"
          onClick={onEmergencyStop}
          className="flex items-center gap-1 text-rose-400 hover:text-rose-300 font-bold active:scale-95 transition-all"
        >
          <AlertOctagon className="w-3.5 h-3.5 text-rose-500 animate-pulse" />
          Abort Movement
        </button>
      </div>
    </div>
  );
};
