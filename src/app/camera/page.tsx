'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import {
  Camera,
  VideoOff,
  SwitchCamera,
  Eye,
  AlertTriangle,
  RefreshCw,
  Sparkles,
  ArrowLeft,
  Sliders,
  Zap,
  Activity,
  Check,
  Bug,
  UploadCloud,
} from 'lucide-react';
import { GeminiVisionRecommendation, DetectedObject } from '@/types/robot';

type CameraState = 'idle' | 'requesting_permission' | 'streaming' | 'error';

interface CameraErrorDetails {
  name: string;
  message: string;
}

interface VideoDiagnostics {
  readyState: number;
  readyStateLabel: string;
  videoWidth: number;
  videoHeight: number;
  paused: boolean;
  currentTime: number;
}

interface TrackDiagnostics {
  readyState: string;
  enabled: boolean;
  muted: boolean;
  label: string;
}

const READY_STATE_MAP: Record<number, string> = {
  0: '0 - HAVE_NOTHING',
  1: '1 - HAVE_METADATA',
  2: '2 - HAVE_CURRENT_DATA',
  3: '3 - HAVE_FUTURE_DATA',
  4: '4 - HAVE_ENOUGH_DATA',
};

export default function MobileCameraPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  // 1. Core Camera State
  const [cameraState, setCameraState] = useState<CameraState>('idle');
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [streamError, setStreamError] = useState<string | null>(null);
  const [lastError, setLastError] = useState<CameraErrorDetails | null>(null);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const [availableDevices, setAvailableDevices] = useState<Array<{ deviceId: string; label: string }>>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

  // Diagnostics State
  const [isSecureContext, setIsSecureContext] = useState<boolean | null>(null);
  const [hasGetUserMedia, setHasGetUserMedia] = useState<boolean | null>(null);
  const [permissionState, setPermissionState] = useState<string>('checking');
  const [videoDiag, setVideoDiag] = useState<VideoDiagnostics>({
    readyState: 0,
    readyStateLabel: '0 - HAVE_NOTHING',
    videoWidth: 0,
    videoHeight: 0,
    paused: true,
    currentTime: 0,
  });
  const [trackDiag, setTrackDiag] = useState<TrackDiagnostics | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState<boolean>(true);

  // Capture Test State
  const [testCaptureUrl, setTestCaptureUrl] = useState<string | null>(null);
  const [testCaptureBytes, setTestCaptureBytes] = useState<number | null>(null);
  const [testCaptureError, setTestCaptureError] = useState<string | null>(null);
  const [testCaptureTimestamp, setTestCaptureTimestamp] = useState<string | null>(null);

  // Snapshot Relay Instrumentation State
  const [relayHttpStatus, setRelayHttpStatus] = useState<number | null>(null);
  const [relayResponseBody, setRelayResponseBody] = useState<string | null>(null);
  const [relayNetworkError, setRelayNetworkError] = useState<string | null>(null);
  const [relayLatencyMs, setRelayLatencyMs] = useState<number | null>(null);
  const [isTestRelaying, setIsTestRelaying] = useState<boolean>(false);
  const [testRelayResult, setTestRelayResult] = useState<string | null>(null);
  const [laptopActive, setLaptopActive] = useState<boolean>(false);
  const [storageBackend, setStorageBackend] = useState<string | null>(null);
  const [relayStatus, setRelayStatus] = useState<'idle' | 'streaming' | 'error'>('idle');

  // Vision Analysis State
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [recommendation, setRecommendation] = useState<GeminiVisionRecommendation | null>(null);
  const [lastAnalyzedTime, setLastAnalyzedTime] = useState<string | null>(null);
  const [taskPrompt, setTaskPrompt] = useState<string>('Inspect path for obstacles and suggest safe rover navigation');

  // Continuous Auto-Analyze State
  const [autoAnalyzeEnabled, setAutoAnalyzeEnabled] = useState<boolean>(false);
  const [autoIntervalSec, setAutoIntervalSec] = useState<number>(5);
  const [countdown, setCountdown] = useState<number>(5);
  const [shutterFlash, setShutterFlash] = useState<boolean>(false);

  // Wake Lock Ref
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  // Initial environment verification & permissions query (deferred to avoid set-state-in-effect)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (typeof window !== 'undefined') {
        setIsSecureContext(window.isSecureContext);
        setHasGetUserMedia(Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia));

        if ('permissions' in navigator && navigator.permissions.query) {
          navigator.permissions
            .query({ name: 'camera' as PermissionName })
            .then((status) => {
              setPermissionState(status.state);
              status.onchange = () => {
                setPermissionState(status.state);
              };
            })
            .catch(() => {
              setPermissionState('unsupported');
            });
        } else {
          setPermissionState('unsupported');
        }
      }
    }, 0);

    return () => clearTimeout(timer);
  }, []);

  // Periodic video & track diagnostics updater
  useEffect(() => {
    const interval = setInterval(() => {
      if (videoRef.current) {
        const v = videoRef.current;
        setVideoDiag({
          readyState: v.readyState,
          readyStateLabel: READY_STATE_MAP[v.readyState] || `Unknown (${v.readyState})`,
          videoWidth: v.videoWidth || 0,
          videoHeight: v.videoHeight || 0,
          paused: v.paused,
          currentTime: Math.round(v.currentTime * 10) / 10,
        });
      }

      if (mediaStream) {
        const track = mediaStream.getVideoTracks()[0];
        if (track) {
          setTrackDiag({
            readyState: track.readyState,
            enabled: track.enabled,
            muted: track.muted,
            label: track.label || 'Video Track',
          });
        } else {
          setTrackDiag(null);
        }
      } else {
        setTrackDiag(null);
      }
    }, 400);

    return () => clearInterval(interval);
  }, [mediaStream]);

  // Enumerate all available camera devices
  const enumerateCameras = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices.filter((d) => d.kind === 'videoinput');
      setAvailableDevices(
        videoInputs.map((d, index) => ({
          deviceId: d.deviceId,
          label: d.label || `Camera ${index + 1}`,
        }))
      );
    } catch {
      // Ignore
    }
  }, []);

  // Screen WakeLock management
  const requestWakeLock = useCallback(async () => {
    try {
      if ('wakeLock' in navigator && (navigator as Navigator & { wakeLock?: { request: (type: string) => Promise<WakeLockSentinel> } }).wakeLock) {
        wakeLockRef.current = await (navigator as Navigator & { wakeLock: { request: (type: string) => Promise<WakeLockSentinel> } }).wakeLock.request('screen');
      }
    } catch {
      // Denied or unsupported
    }
  }, []);

  const releaseWakeLock = useCallback(async () => {
    try {
      if (wakeLockRef.current) {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
      }
    } catch {
      // Ignore
    }
  }, []);

  // Stop camera tracks cleanly
  const stopCamera = useCallback(() => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    setMediaStream(null);
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
    setCameraState('idle');
    setAutoAnalyzeEnabled(false);
    setRelayStatus('idle');
    releaseWakeLock();
  }, [releaseWakeLock]);

  // Error handling helper declared before startCamera to respect immutability
  const handleCameraInitError = useCallback(
    (err: unknown) => {
      stopCamera();
      const name = err instanceof Error ? err.name : (err as { name?: string })?.name || 'UnknownError';
      const message = err instanceof Error ? err.message : (err as { message?: string })?.message || 'Failed to initialize camera.';
      setLastError({ name, message });
      setCameraState('error');

      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setStreamError('Camera permission denied. Please allow camera access in browser site settings.');
      } else if (name === 'NotReadableError') {
        setStreamError('Camera hardware is busy or in use by another application.');
      } else if (name === 'OverconstrainedError') {
        setStreamError('Requested camera constraints could not be satisfied by device hardware.');
      } else if (name === 'NotFoundError') {
        setStreamError('No physical camera device was found on this hardware.');
      } else if (name === 'AbortError') {
        setStreamError('Camera initialization was interrupted by a new request or the operating system.');
      } else {
        setStreamError(`Camera error (${name}): ${message}`);
      }
    },
    [stopCamera]
  );

  // Robust Camera Start Handler with Strict Validation & Fallback
  const startCamera = useCallback(
    async (targetFacing = facingMode, deviceIdOverride?: string) => {
      setCameraState('requesting_permission');
      setStreamError(null);
      setLastError(null);

      // Stop all old media tracks before starting or restarting
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }

      // Verify browser API availability
      if (typeof window !== 'undefined' && !window.isSecureContext) {
        const err = {
          name: 'InsecureContextError',
          message: 'Camera access requires a secure context (HTTPS or localhost).',
        };
        setLastError(err);
        setStreamError(err.message);
        setCameraState('error');
        return;
      }

      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        const err = {
          name: 'UnsupportedBrowserAPI',
          message: 'navigator.mediaDevices.getUserMedia is not supported on this browser.',
        };
        setLastError(err);
        setStreamError(err.message);
        setCameraState('error');
        return;
      }

      const devId = deviceIdOverride || selectedDeviceId;
      let stream: MediaStream | null = null;

      // Attempt 1: Rear camera with ideal resolution constraints
      const primaryConstraints: MediaStreamConstraints = {
        audio: false,
        video: devId
          ? { deviceId: { exact: devId } }
          : {
              facingMode: { ideal: targetFacing },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
      };

      try {
        stream = await navigator.mediaDevices.getUserMedia(primaryConstraints);
      } catch (primaryErr: unknown) {
        const errName = primaryErr instanceof Error ? primaryErr.name : (primaryErr as { name?: string })?.name || '';
        // If OverconstrainedError or NotFoundError, retry with basic video: true fallback
        if (errName === 'OverconstrainedError' || errName === 'NotFoundError') {
          try {
            console.warn(`Primary constraints failed (${errName}), retrying with fallback { video: true }`);
            stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
          } catch (fallbackErr: unknown) {
            handleCameraInitError(fallbackErr);
            return;
          }
        } else {
          handleCameraInitError(primaryErr);
          return;
        }
      }

      if (!stream) {
        handleCameraInitError(new Error('No media stream returned from getUserMedia.'));
        return;
      }

      // Record selected device ID from active track
      const activeTrack = stream.getVideoTracks()[0];
      if (activeTrack) {
        const trackSettings = activeTrack.getSettings();
        if (trackSettings.deviceId) {
          setSelectedDeviceId(trackSettings.deviceId);
        }
      }

      // Attach stream to video element
      if (!videoRef.current) {
        handleCameraInitError(new Error('Video element ref unavailable.'));
        return;
      }

      const video = videoRef.current;
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;

      // Explicitly await video.play()
      try {
        await video.play();
      } catch (playErr: unknown) {
        const pErr = playErr instanceof Error ? playErr : (playErr as { name?: string; message?: string });
        if (pErr?.name === 'AbortError') {
          console.warn('Play request aborted by browser:', playErr);
        } else {
          console.warn('video.play() warning:', playErr);
        }
      }

      // Mark connected and streaming so video paints immediately
      mediaStreamRef.current = stream;
      setMediaStream(stream);
      setCameraActive(true);
      setCameraState('streaming');
      requestWakeLock();
      await enumerateCameras();
    },
    [facingMode, selectedDeviceId, requestWakeLock, enumerateCameras, handleCameraInitError]
  );

  // Switch facing mode
  const switchFacing = async () => {
    const next = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(next);
    setSelectedDeviceId(null);
    if (cameraActive) {
      stopCamera();
      setTimeout(() => {
        startCamera(next);
      }, 200);
    }
  };

  // Switch specific device
  const selectCameraDevice = async (deviceId: string) => {
    setSelectedDeviceId(deviceId);
    if (cameraActive) {
      stopCamera();
      setTimeout(() => {
        startCamera(facingMode, deviceId);
      }, 200);
    }
  };

  // Capture current video frame into JPEG dataUrl (with dimensions check)
  const captureCurrentFrame = useCallback((): string | null => {
    if (!videoRef.current || !canvasRef.current) return null;
    const video = videoRef.current;
    const canvas = canvasRef.current;

    const width = video.videoWidth;
    const height = video.videoHeight;

    if (!width || !height || width <= 0 || height <= 0) {
      return null;
    }

    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(video, 0, 0, width, height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);

    if (!dataUrl || dataUrl.length < 50 || dataUrl === 'data:,') {
      return null;
    }

    return dataUrl;
  }, []);

  // Requirement 3: Capture Test Action
  const testCaptureFrame = () => {
    setTestCaptureError(null);
    if (!videoRef.current || !canvasRef.current) {
      setTestCaptureError('Video or canvas reference is not available.');
      return;
    }

    const video = videoRef.current;
    if (!video.videoWidth || !video.videoHeight || video.videoWidth <= 0 || video.videoHeight <= 0) {
      setTestCaptureError(`Invalid video dimensions: ${video.videoWidth}x${video.videoHeight}. Cannot capture frame.`);
      return;
    }

    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setTestCaptureError('Canvas 2D context unavailable.');
      return;
    }

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);

    if (!dataUrl || dataUrl.length < 50 || dataUrl === 'data:,') {
      setTestCaptureError('Canvas encoding failed or produced empty image data.');
      return;
    }

    const base64Data = dataUrl.split(',')[1] || '';
    const bytes = Math.round((base64Data.length * 3) / 4);

    setTestCaptureUrl(dataUrl);
    setTestCaptureBytes(bytes);
    setTestCaptureTimestamp(new Date().toLocaleTimeString());
  };

  // Requirement 4: Snapshot Relay Helper
  const sendRelayFrame = useCallback(
    async (frameUrl: string, width: number, height: number): Promise<boolean> => {
      const t0 = performance.now();
      try {
        const res = await fetch('/api/camera/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            dataUrl: frameUrl,
            width,
            height,
            facingMode,
          }),
        });

        const elapsed = Math.round(performance.now() - t0);
        setRelayLatencyMs(elapsed);
        setRelayHttpStatus(res.status);

        const bodyText = await res.text();
        setRelayResponseBody(bodyText.slice(0, 160));

        if (!res.ok) {
          setRelayStatus('error');
          setRelayNetworkError(`HTTP ${res.status}: ${bodyText}`);
          return false;
        }

        const data = JSON.parse(bodyText);
        setLaptopActive(Boolean(data.laptopActive));
        setStorageBackend(data.storageBackend || null);
        setRelayStatus(data.laptopActive ? 'streaming' : 'idle');
        setRelayNetworkError(null);
        return true;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Network request failed.';
        setRelayStatus('error');
        setRelayHttpStatus(0);
        setRelayNetworkError(msg);
        return false;
      }
    },
    [facingMode]
  );

  // Requirement 4: Single Frame Test Relay Button
  const testRelaySingleFrame = async () => {
    setIsTestRelaying(true);
    setTestRelayResult(null);

    const frame = captureCurrentFrame();
    if (!frame) {
      setTestRelayResult('Failed: No valid frame captured (dimensions 0x0 or encoding failure).');
      setIsTestRelaying(false);
      return;
    }

    const w = videoRef.current?.videoWidth || 1280;
    const h = videoRef.current?.videoHeight || 720;
    const success = await sendRelayFrame(frame, w, h);
    if (success) {
      setTestRelayResult(`Success: Relayed ${w}x${h} frame (HTTP 200).`);
    } else {
      setTestRelayResult('Failed: Check relay diagnostics for error details.');
    }
    setIsTestRelaying(false);
  };

  // Automated Snapshot Relay Loop (Only runs while streaming)
  useEffect(() => {
    if (cameraState !== 'streaming' || !cameraActive) return;

    const relayInterval = setInterval(async () => {
      const frameUrl = captureCurrentFrame();
      if (!frameUrl) return;

      const w = videoRef.current?.videoWidth || 1280;
      const h = videoRef.current?.videoHeight || 720;
      await sendRelayFrame(frameUrl, w, h);
    }, 1800); // 1.8s adaptive relay loop

    return () => clearInterval(relayInterval);
  }, [cameraState, cameraActive, captureCurrentFrame, sendRelayFrame]);

  // Send single frame to Gemini AI Vision API
  const analyzeFrame = useCallback(async () => {
    if (!cameraActive || isAnalyzing) return;

    const dataUrl = captureCurrentFrame();
    if (!dataUrl) {
      setAnalysisError('Cannot analyze: Video dimensions are invalid or camera is not producing frames.');
      return;
    }

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

  // Cleanup ONLY on actual component unmount
  useEffect(() => {
    return () => {
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
      }
    };
  }, []);

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
              <span className={`w-2 h-2 rounded-full ${cameraState === 'streaming' ? 'bg-cyan-400 animate-pulse' : 'bg-slate-600'}`} />
              NEX-ROVER MOBILE CAM
            </h1>
            <p className="text-[10px] font-mono text-slate-400">Mount on Rover Chassis</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Laptop Stream Relay Badge - Only reports sync when laptop actually receives frames */}
          <div
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono border ${
              laptopActive
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                : relayStatus === 'error'
                ? 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                : cameraActive
                ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                : 'bg-slate-800 text-slate-400 border-slate-700'
            }`}
            title="Relaying live preview frames to laptop dashboard"
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                laptopActive
                  ? 'bg-emerald-400 animate-ping'
                  : cameraActive
                  ? 'bg-amber-400'
                  : 'bg-slate-500'
              }`}
            />
            <span>
              {laptopActive
                ? 'LAPTOP SYNC'
                : cameraActive
                ? 'WAITING FOR LAPTOP'
                : 'OFFLINE'}
            </span>
          </div>

          {/* Toggle Diagnostics Panel */}
          <button
            onClick={() => setShowDiagnostics(!showDiagnostics)}
            title="Toggle Camera Diagnostics Panel"
            className={`p-2 rounded-lg border text-xs transition-all ${
              showDiagnostics
                ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                : 'bg-slate-800 text-slate-400 border-slate-700'
            }`}
          >
            <Bug className="w-4 h-4" />
          </button>

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
            playsInline
            muted
            autoPlay
            className={`w-full h-full object-cover transition-opacity duration-300 ${
              cameraActive ? 'opacity-100' : 'opacity-0 pointer-events-none'
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
                {cameraState === 'requesting_permission'
                  ? 'Requesting camera permission from browser...'
                  : 'Position your phone on the rover chassis and tap Start Camera below.'}
              </p>

              {streamError && (
                <div className="mt-3 p-3 rounded-lg bg-rose-950/70 border border-rose-500/40 text-xs font-mono text-rose-300 text-left flex items-start gap-2 max-w-xs">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
                  <div>
                    <div className="font-bold">{lastError?.name || 'Camera Error'}</div>
                    <div className="text-[11px] text-rose-300/80 mt-0.5">{streamError}</div>
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={() => startCamera()}
                disabled={cameraState === 'requesting_permission'}
                className="mt-4 flex items-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 disabled:opacity-50 text-white font-mono text-xs font-bold tracking-wide shadow-lg shadow-cyan-950 active:scale-95 transition-all"
              >
                {cameraState === 'requesting_permission' ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Connecting...</span>
                  </>
                ) : (
                  <>
                    <Camera className="w-4 h-4" />
                    <span>Start Camera</span>
                  </>
                )}
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
                  <span>LIVE • {videoDiag.videoWidth}x{videoDiag.videoHeight}</span>
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

        {/* Camera Device Selector & Lens Switch Bar */}
        <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 shadow-inner">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Camera className="w-4 h-4 text-cyan-400 shrink-0" />
            <span className="text-[11px] font-mono text-slate-400 shrink-0">Device:</span>
            {availableDevices.length > 0 ? (
              <select
                value={selectedDeviceId || ''}
                onChange={(e) => selectCameraDevice(e.target.value)}
                className="bg-slate-800 border border-slate-700 text-cyan-300 text-xs font-mono rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-cyan-500 w-full truncate cursor-pointer hover:border-slate-600 transition-colors"
              >
                {availableDevices.map((dev, idx) => (
                  <option key={dev.deviceId || idx} value={dev.deviceId}>
                    {dev.label || `Camera ${idx + 1}`}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-xs font-mono text-cyan-300 truncate">
                {facingMode === 'environment' ? 'Rear / Main Camera' : 'Front / User Camera'}
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={switchFacing}
            className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 font-mono text-xs font-bold active:scale-95 transition-all shrink-0 shadow-sm"
          >
            <SwitchCamera className="w-3.5 h-3.5" />
            <span>Flip Lens ({facingMode === 'environment' ? 'Rear' : 'Front'})</span>
          </button>
        </div>

        {/* Primary Camera & AI Controls */}
        <div className="grid grid-cols-2 gap-2">
          {cameraActive ? (
            <button
              type="button"
              onClick={stopCamera}
              className="flex items-center justify-center gap-2 py-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-rose-400 border border-rose-500/30 font-mono text-xs font-bold active:scale-95 transition-all shadow-md"
            >
              <VideoOff className="w-4 h-4" /> Stop Camera
            </button>
          ) : (
            <button
              type="button"
              onClick={() => startCamera()}
              disabled={cameraState === 'requesting_permission'}
              className="flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 disabled:opacity-50 text-white font-mono text-xs font-bold active:scale-95 transition-all shadow-md shadow-cyan-950"
            >
              <Camera className="w-4 h-4" /> Start Camera
            </button>
          )}

          <button
            type="button"
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

        {/* Requirement 1: Visible Camera Diagnostics Panel */}
        {showDiagnostics && (
          <section suppressHydrationWarning className="p-3.5 rounded-xl bg-slate-900/90 border border-cyan-500/30 flex flex-col gap-2.5 font-mono text-xs shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <div className="flex items-center gap-1.5 text-cyan-400 font-bold">
                <Activity className="w-4 h-4" />
                <span>Camera Hardware Diagnostics</span>
              </div>
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                  cameraState === 'streaming'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    : cameraState === 'error'
                    ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                    : cameraState === 'requesting_permission'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                    : 'bg-slate-800 text-slate-400'
                }`}
              >
                State: {cameraState}
              </span>
            </div>

            {/* Diagnostics Key-Value Grid */}
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
              <div>
                <span className="text-slate-500">Secure Context:</span>{' '}
                <span className={isSecureContext ? 'text-emerald-400' : 'text-rose-400'}>
                  {isSecureContext === null ? 'Checking...' : isSecureContext ? 'Yes (HTTPS)' : 'No (Insecure)'}
                </span>
              </div>

              <div>
                <span className="text-slate-500">getUserMedia:</span>{' '}
                <span className={hasGetUserMedia ? 'text-emerald-400' : 'text-rose-400'}>
                  {hasGetUserMedia ? 'Supported' : 'Missing'}
                </span>
              </div>

              <div>
                <span className="text-slate-500">Permission:</span>{' '}
                <span className="text-cyan-300 capitalize">{permissionState}</span>
              </div>

              <div>
                <span className="text-slate-500">Video Dimensions:</span>{' '}
                <span className={videoDiag.videoWidth > 0 ? 'text-emerald-400 font-bold' : 'text-amber-400'}>
                  {videoDiag.videoWidth} x {videoDiag.videoHeight}
                </span>
              </div>

              <div>
                <span className="text-slate-500">Video readyState:</span>{' '}
                <span className="text-slate-200">{videoDiag.readyStateLabel}</span>
              </div>

              <div>
                <span className="text-slate-500">Video Paused:</span>{' '}
                <span className={videoDiag.paused ? 'text-amber-400' : 'text-emerald-400'}>
                  {videoDiag.paused ? 'Yes' : 'No'} ({videoDiag.currentTime}s)
                </span>
              </div>

              {trackDiag && (
                <>
                  <div>
                    <span className="text-slate-500">Track State:</span>{' '}
                    <span className="text-cyan-300">
                      {trackDiag.readyState} (Muted: {trackDiag.muted ? 'Yes' : 'No'})
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500">Track Label:</span>{' '}
                    <span className="text-slate-300 truncate block" title={trackDiag.label}>
                      {trackDiag.label}
                    </span>
                  </div>
                </>
              )}
            </div>

            {/* Error Message Section if Present */}
            {lastError && (
              <div className="p-2.5 rounded bg-rose-950/60 border border-rose-500/40 text-rose-300 text-[11px]">
                <div className="font-bold flex items-center gap-1 text-rose-400">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>{lastError.name}</span>
                </div>
                <div className="mt-0.5 text-rose-200/90">{lastError.message}</div>
              </div>
            )}

            {/* Diagnostic Actions: Capture Test & Test Relay */}
            <div className="pt-2 border-t border-slate-800 flex flex-col gap-2">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={testCaptureFrame}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 text-xs font-bold active:scale-95 transition-all"
                >
                  <Camera className="w-3.5 h-3.5" />
                  <span>Test Capture</span>
                </button>

                <button
                  type="button"
                  onClick={testRelaySingleFrame}
                  disabled={isTestRelaying}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-indigo-300 border border-slate-700 text-xs font-bold active:scale-95 transition-all"
                >
                  {isTestRelaying ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <UploadCloud className="w-3.5 h-3.5" />
                  )}
                  <span>Test Relay</span>
                </button>
              </div>

              {/* Requirement 3: Capture Test Result Display */}
              {testCaptureError && (
                <div className="p-2 rounded bg-rose-950/50 border border-rose-500/30 text-rose-300 text-[11px]">
                  Capture Error: {testCaptureError}
                </div>
              )}

              {testCaptureUrl && (
                <div className="p-2.5 rounded bg-slate-950 border border-slate-800 flex items-center gap-3">
                  <img
                    src={testCaptureUrl}
                    alt="Captured Test Preview"
                    className="w-16 h-12 object-cover rounded border border-slate-700"
                  />
                  <div className="text-[11px] text-slate-300 flex-1">
                    <div className="text-emerald-400 font-bold flex items-center gap-1">
                      <Check className="w-3 h-3" /> Valid Frame Encoded
                    </div>
                    <div>Size: {((testCaptureBytes || 0) / 1024).toFixed(1)} KB ({testCaptureBytes} bytes)</div>
                    <div className="text-[10px] text-slate-500">Captured at {testCaptureTimestamp}</div>
                  </div>
                </div>
              )}

              {/* Requirement 4: Snapshot Relay Result Display */}
              {(relayHttpStatus !== null || testRelayResult) && (
                <div className="p-2 rounded bg-slate-950 border border-slate-800 text-[11px] flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Relay HTTP Status:</span>
                    <span
                      className={`font-bold ${
                        relayHttpStatus === 200 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {relayHttpStatus ? `HTTP ${relayHttpStatus}` : 'Network Error'} ({relayLatencyMs}ms)
                    </span>
                  </div>

                  {storageBackend && (
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-slate-500">Transport Store:</span>
                      <span className="text-cyan-300">{storageBackend}</span>
                    </div>
                  )}

                  {relayResponseBody && (
                    <div className="text-[10px] text-slate-400 truncate">
                      Resp: {relayResponseBody}
                    </div>
                  )}

                  {relayNetworkError && (
                    <div className="text-[10px] text-rose-400">
                      Error: {relayNetworkError}
                    </div>
                  )}

                  {testRelayResult && (
                    <div className="text-[10px] text-indigo-300 font-bold pt-1 border-t border-slate-800/80">
                      {testRelayResult}
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
        )}

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

            {analysisError && (
              <div className="p-2.5 rounded bg-rose-950/60 border border-rose-500/40 text-xs font-mono text-rose-300">
                {analysisError}
              </div>
            )}

            <div>
              <div className="text-[10px] font-mono text-slate-500 uppercase">Scene Summary</div>
              <p className="text-xs font-mono text-slate-200 mt-0.5 leading-relaxed">
                {recommendation.sceneSummary}
              </p>
            </div>

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
