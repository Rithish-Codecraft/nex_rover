'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import {
  Camera,
  VideoOff,
  SwitchCamera,
  Eye,
  AlertTriangle,
  CheckCircle,
  RefreshCw,
  Shield,
  Layers,
  Sparkles,
  ArrowLeft,
  Sliders,
  Send,
  Zap,
} from 'lucide-react';
import { GeminiVisionRecommendation, DetectedObject } from '@/types/robot';

export default function MobileCameraPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Camera State
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [streamError, setStreamError] = useState<string | null>(null);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);

  // Vision Analysis State
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [recommendation, setRecommendation] = useState<GeminiVisionRecommendation | null>(null);
  const [lastAnalyzedTime, setLastAnalyzedTime] = useState<string | null>(null);
  const [taskPrompt, setTaskPrompt] = useState<string>('Inspect path for obstacles and suggest safe rover navigation');

  // Continuous Auto-Analyze State
  const [autoAnalyzeEnabled, setAutoAnalyzeEnabled] = useState<boolean>(false);
  const [autoIntervalSec, setAutoIntervalSec] = useState<number>(5); // 3, 5, or 10 seconds
  const [countdown, setCountdown] = useState<number>(5);

  // Shutter Flash & Relay Status
  const [shutterFlash, setShutterFlash] = useState<boolean>(false);
  const [relayStatus, setRelayStatus] = useState<'idle' | 'streaming' | 'error'>('idle');

  // Wake Lock Ref
  const wakeLockRef = useRef<any>(null);

  // Request WakeLock to keep mobile screen on while rover camera is mounted
  const requestWakeLock = useCallback(async () => {
    try {
      if ('wakeLock' in navigator && (navigator as any).wakeLock) {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
      }
    } catch {
      // Wake lock request may be denied on low battery
    }
  }, []);

  const releaseWakeLock = useCallback(async () => {
    try {
      if (wakeLockRef.current) {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
      }
    } catch {
      // Ignore error
    }
  }, []);

  // Stop camera tracks cleanly
  const stopCamera = useCallback(() => {
    if (mediaStream) {
      mediaStream.getTracks().forEach((track) => track.stop());
      setMediaStream(null);
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
    setAutoAnalyzeEnabled(false);
    setRelayStatus('idle');
    releaseWakeLock();
  }, [mediaStream, releaseWakeLock]);

  // Start mobile camera with facingMode
  const startCamera = useCallback(async (targetFacing = facingMode) => {
    setStreamError(null);
    try {
      if (mediaStream) {
        mediaStream.getTracks().forEach((track) => track.stop());
      }

      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: { ideal: targetFacing },
          width: { ideal: 1280, max: 1920 },
          height: { ideal: 720, max: 1080 },
        },
        audio: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      setMediaStream(stream);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true');
        videoRef.current.setAttribute('muted', 'true');
        await videoRef.current.play();
      }

      setCameraActive(true);
      requestWakeLock();
    } catch (err: unknown) {
      stopCamera();
      if (err instanceof DOMException) {
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          setStreamError('Camera permission denied. Please allow camera access in browser site settings.');
        } else if (err.name === 'NotFoundError') {
          setStreamError(`No physical ${targetFacing === 'environment' ? 'rear' : 'front'} camera detected on device.`);
        } else if (err.name === 'NotReadableError') {
          setStreamError('Camera is currently in use by another application or tab.');
        } else {
          setStreamError(`Camera initialization error: ${err.message}`);
        }
      } else {
        setStreamError('Failed to access device camera.');
      }
    }
  }, [facingMode, mediaStream, requestWakeLock, stopCamera]);

  // Switch facing mode (Front vs Rear)
  const switchFacing = async () => {
    const next = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(next);
    if (cameraActive) {
      stopCamera();
      setTimeout(() => {
        startCamera(next);
      }, 200);
    }
  };

  // Capture current video frame into JPEG dataUrl
  const captureCurrentFrame = useCallback((): string | null => {
    if (!videoRef.current || !canvasRef.current) return null;
    const video = videoRef.current;
    const canvas = canvasRef.current;

    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(video, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', 0.85);
  }, []);

  // Send single frame to Gemini AI Vision API
  const analyzeFrame = useCallback(async () => {
    if (!cameraActive || isAnalyzing) return;

    const dataUrl = captureCurrentFrame();
    if (!dataUrl) return;

    // Trigger visual shutter flash
    setShutterFlash(true);
    setTimeout(() => setShutterFlash(false), 200);

    setIsAnalyzing(true);
    setAnalysisError(null);

    try {
      const res = await fetch('/api/vision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: dataUrl,
          task: taskPrompt,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `Server responded with status ${res.status}`);
      }

      setRecommendation(data.recommendation);
      setLastAnalyzedTime(new Date().toLocaleTimeString());
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Vision analysis failed';
      setAnalysisError(msg);
    } finally {
      setIsAnalyzing(false);
    }
  }, [cameraActive, captureCurrentFrame, isAnalyzing, taskPrompt]);

  // Relay preview snapshot to laptop dashboard (/api/camera/stream)
  useEffect(() => {
    if (!cameraActive) return;

    const relayInterval = setInterval(async () => {
      const frameUrl = captureCurrentFrame();
      if (!frameUrl) return;

      try {
        await fetch('/api/camera/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            dataUrl: frameUrl,
            width: videoRef.current?.videoWidth || 1280,
            height: videoRef.current?.videoHeight || 720,
            facingMode,
          }),
        });
        setRelayStatus('streaming');
      } catch {
        setRelayStatus('error');
      }
    }, 1500); // 1.5s preview frame relay

    return () => clearInterval(relayInterval);
  }, [cameraActive, captureCurrentFrame, facingMode]);

  // Continuous Auto-Analyze Countdown Loop
  useEffect(() => {
    if (!autoAnalyzeEnabled || !cameraActive) return;

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          analyzeFrame();
          return autoIntervalSec;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [autoAnalyzeEnabled, autoIntervalSec, cameraActive, analyzeFrame]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-cyan-500 selection:text-black">
      {/* Offscreen Canvas for Frame Capture */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Top Mobile Bar */}
      <header className="h-14 px-4 bg-slate-900/90 backdrop-blur-md border-b border-slate-800 flex items-center justify-between sticky top-0 z-40">
        <div className="flex items-center gap-2">
          <Link
            href="/"
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
            title="Return to Main Dashboard"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="text-xs font-mono font-bold tracking-wider text-cyan-400 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
              NEX-ROVER MOBILE CAM
            </h1>
            <p className="text-[10px] font-mono text-slate-400">Mount on Rover Chassis</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Laptop Stream Relay Badge */}
          <div
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono border ${
              relayStatus === 'streaming'
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                : 'bg-slate-800 text-slate-400 border-slate-700'
            }`}
            title="Relaying live preview frames to laptop dashboard"
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                relayStatus === 'streaming' ? 'bg-emerald-400 animate-ping' : 'bg-slate-500'
              }`}
            />
            <span>{relayStatus === 'streaming' ? 'LAPTOP SYNC' : 'OFFLINE'}</span>
          </div>

          {/* Camera Switcher */}
          <button
            onClick={switchFacing}
            title={`Switch to ${facingMode === 'environment' ? 'Front' : 'Rear'} camera`}
            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 active:scale-95 transition-all"
          >
            <SwitchCamera className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Viewport Container */}
      <main className="flex-1 flex flex-col p-3 max-w-lg mx-auto w-full gap-3">
        {/* Video Viewport Card */}
        <div className="relative rounded-2xl overflow-hidden bg-black border border-slate-800 aspect-[4/3] shadow-2xl flex items-center justify-center">
          {/* Shutter Flash Animation */}
          {shutterFlash && (
            <div className="absolute inset-0 bg-white z-30 opacity-70 pointer-events-none transition-opacity duration-150" />
          )}

          <video
            ref={videoRef}
            className={`w-full h-full object-cover transition-opacity duration-300 ${
              cameraActive ? 'opacity-100' : 'opacity-0'
            }`}
          />

          {/* Inactive Placeholder */}
          {!cameraActive && (
            <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
              <div className="w-16 h-16 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-400 mb-3 shadow-inner">
                <Camera className="w-8 h-8 text-cyan-400" />
              </div>
              <h2 className="text-sm font-bold font-mono text-slate-200">
                Rover Camera ({facingMode === 'environment' ? 'Rear Lens' : 'Front Lens'})
              </h2>
              <p className="text-xs font-mono text-slate-400 mt-1 max-w-xs">
                Position your phone at the front of the rover and tap Start Camera below.
              </p>

              {streamError && (
                <div className="mt-3 p-3 rounded-lg bg-rose-950/70 border border-rose-500/40 text-xs font-mono text-rose-300 text-left flex items-start gap-2 max-w-xs">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
                  <span>{streamError}</span>
                </div>
              )}

              <button
                onClick={() => startCamera()}
                className="mt-4 flex items-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-mono text-xs font-bold tracking-wide shadow-lg shadow-cyan-950 active:scale-95 transition-all"
              >
                <Camera className="w-4 h-4" /> Start Camera
              </button>
            </div>
          )}

          {/* Tactical HUD Overlay (When Camera is Active) */}
          {cameraActive && (
            <div className="absolute inset-0 pointer-events-none p-3 flex flex-col justify-between">
              {/* Top Status Badges */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-black/60 backdrop-blur-md border border-cyan-500/40 text-[10px] font-mono text-cyan-300">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
                  <span>LIVE • {facingMode.toUpperCase()}</span>
                </div>

                {autoAnalyzeEnabled && (
                  <div className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-indigo-950/80 backdrop-blur-md border border-indigo-500/50 text-[10px] font-mono text-indigo-300 font-bold animate-pulse">
                    <Sparkles className="w-3 h-3 text-indigo-400" />
                    <span>AUTO IN {countdown}s</span>
                  </div>
                )}
              </div>

              {/* Center Reticle */}
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="relative w-28 h-28 border border-cyan-400/20 rounded-full flex items-center justify-center">
                  <div className="w-2 h-2 rounded-full bg-cyan-400/50" />
                  <div className="absolute top-0 w-px h-3.5 bg-cyan-400/60" />
                  <div className="absolute bottom-0 w-px h-3.5 bg-cyan-400/60" />
                  <div className="absolute left-0 h-px w-3.5 bg-cyan-400/60" />
                  <div className="absolute right-0 h-px w-3.5 bg-cyan-400/60" />
                </div>
              </div>

              {/* Bottom HUD Bar */}
              <div className="flex items-center justify-between text-[10px] font-mono text-slate-300">
                <span className="px-2 py-0.5 rounded bg-black/60 backdrop-blur-sm border border-slate-800">
                  {isAnalyzing ? 'ANALYZING...' : 'AI READY'}
                </span>
                {lastAnalyzedTime && (
                  <span className="px-2 py-0.5 rounded bg-black/60 backdrop-blur-sm border border-slate-800 text-slate-400">
                    LAST: {lastAnalyzedTime}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Primary Camera & AI Controls */}
        <div className="grid grid-cols-2 gap-2">
          {cameraActive ? (
            <button
              onClick={stopCamera}
              className="flex items-center justify-center gap-2 py-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-rose-400 border border-rose-500/30 font-mono text-xs font-bold active:scale-95 transition-all shadow-md"
            >
              <VideoOff className="w-4 h-4" /> Stop Camera
            </button>
          ) : (
            <button
              onClick={() => startCamera()}
              className="flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-mono text-xs font-bold active:scale-95 transition-all shadow-md shadow-cyan-950"
            >
              <Camera className="w-4 h-4" /> Start Camera
            </button>
          )}

          <button
            onClick={analyzeFrame}
            disabled={!cameraActive || isAnalyzing}
            className={`flex items-center justify-center gap-2 py-3 rounded-xl font-mono text-xs font-bold transition-all shadow-md ${
              !cameraActive || isAnalyzing
                ? 'bg-slate-900 text-slate-600 border border-slate-800 cursor-not-allowed'
                : 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white shadow-indigo-950 active:scale-95'
            }`}
          >
            {isAnalyzing ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin text-indigo-300" />
                <span>Analyzing...</span>
              </>
            ) : (
              <>
                <Eye className="w-4 h-4" />
                <span>Capture & Analyze</span>
              </>
            )}
          </button>
        </div>

        {/* Continuous Auto-Analyze Configuration Bar */}
        <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-cyan-400" />
              <span className="text-xs font-mono font-bold text-slate-200">Continuous Vision Loop</span>
            </div>
            <button
              onClick={() => {
                if (!cameraActive) {
                  startCamera().then(() => setAutoAnalyzeEnabled(true));
                } else {
                  setAutoAnalyzeEnabled(!autoAnalyzeEnabled);
                  setCountdown(autoIntervalSec);
                }
              }}
              className={`px-3 py-1 rounded-lg text-xs font-mono font-bold transition-all ${
                autoAnalyzeEnabled
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-700'
              }`}
            >
              {autoAnalyzeEnabled ? 'Active' : 'Disabled'}
            </button>
          </div>

          <div className="flex items-center justify-between pt-1 border-t border-slate-800/80 text-xs font-mono text-slate-400">
            <span>Interval Rate:</span>
            <div className="flex items-center gap-1.5">
              {[3, 5, 10].map((sec) => (
                <button
                  key={sec}
                  onClick={() => {
                    setAutoIntervalSec(sec);
                    setCountdown(sec);
                  }}
                  className={`px-2.5 py-1 rounded text-[11px] font-mono transition-colors ${
                    autoIntervalSec === sec
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-bold'
                      : 'bg-slate-800 text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {sec}s
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Task Prompt Customizer */}
        <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 flex flex-col gap-1.5">
          <label className="text-[11px] font-mono text-slate-400 flex items-center gap-1.5">
            <Sliders className="w-3.5 h-3.5 text-slate-400" /> Mission Task Objective
          </label>
          <input
            type="text"
            value={taskPrompt}
            onChange={(e) => setTaskPrompt(e.target.value)}
            placeholder="e.g. Inspect floor for red block"
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500"
          />
        </div>

        {/* AI Perception & Structured Decision Card */}
        {recommendation && (
          <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 flex flex-col gap-3 shadow-xl">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <span className="text-xs font-mono font-bold text-cyan-400 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" /> Latest AI Perception
              </span>
              <span
                className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold uppercase ${
                  recommendation.recommendedAction === 'stop'
                    ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                    : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                }`}
              >
                ACTION: {recommendation.recommendedAction}
              </span>
            </div>

            {/* Scene Summary */}
            <div>
              <div className="text-[10px] font-mono text-slate-500 uppercase">Scene Summary</div>
              <p className="text-xs font-mono text-slate-200 mt-0.5 leading-relaxed">
                {recommendation.sceneSummary}
              </p>
            </div>

            {/* Detected Objects List */}
            {recommendation.detectedObjects && recommendation.detectedObjects.length > 0 && (
              <div>
                <div className="text-[10px] font-mono text-slate-500 uppercase mb-1">
                  Detected Objects ({recommendation.detectedObjects.length})
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {recommendation.detectedObjects.map((obj: DetectedObject, idx: number) => (
                    <span
                      key={idx}
                      className="px-2 py-1 rounded-md bg-slate-800/80 border border-slate-700 text-[11px] font-mono text-slate-300 flex items-center gap-1.5"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                      <strong className="text-white">{obj.label}</strong>
                      <span className="text-slate-500 text-[10px]">({obj.direction})</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Hazards List */}
            {recommendation.hazards && recommendation.hazards.length > 0 && (
              <div className="p-2.5 rounded-lg bg-rose-950/40 border border-rose-500/30">
                <div className="text-[10px] font-mono text-rose-400 uppercase font-bold flex items-center gap-1 mb-1">
                  <AlertTriangle className="w-3.5 h-3.5" /> Hazards Identified
                </div>
                <ul className="text-xs font-mono text-rose-200 list-disc list-inside space-y-0.5">
                  {recommendation.hazards.map((h: string, idx: number) => (
                    <li key={idx}>{h}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Reasoning & Movement Details */}
            <div className="text-xs font-mono text-slate-400 bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80">
              <span className="text-slate-500 text-[10px] uppercase block mb-0.5">Reasoning</span>
              {recommendation.reason}
              {recommendation.movement && recommendation.movement.direction !== 'stop' && (
                <div className="mt-2 pt-2 border-t border-slate-800 text-[11px] text-cyan-300">
                  Step: {recommendation.movement.direction.toUpperCase()} at {recommendation.movement.speedPercent}% speed for {recommendation.movement.durationMs}ms
                </div>
              )}
            </div>

            <div className="text-[10px] font-mono text-slate-500 text-center">
              Awaiting operator review on laptop dashboard (Operator Approval Gate enforced)
            </div>
          </div>
        )}

        {/* Quick Link to Laptop Dashboard */}
        <div className="mt-auto pt-4 pb-6 text-center">
          <Link
            href="/"
            className="text-xs font-mono text-slate-400 hover:text-cyan-300 transition-colors inline-flex items-center gap-1.5"
          >
            <span>Open Full Laptop Dashboard</span>
            <ArrowLeft className="w-3.5 h-3.5 rotate-180" />
          </Link>
        </div>
      </main>
    </div>
  );
}
