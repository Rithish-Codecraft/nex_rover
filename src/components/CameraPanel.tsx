'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Camera,
  RefreshCw,
  VideoOff,
  Layers,
  AlertTriangle,
  Smartphone,
  Wifi,
  SwitchCamera,
  ShieldAlert,
  Check,
  Radio,
  ExternalLink,
} from 'lucide-react';
import { CapturedFrame, PhoneCameraSnapshot, RobotSettings } from '@/types/robot';

interface CameraPanelProps {
  streamUrl?: string;
  settings?: RobotSettings;
  isSimulated?: boolean;
  onFrameCaptured?: (frame: CapturedFrame) => void;
  capturedFrame?: CapturedFrame | null;
  obstacleDistance?: number | null;
  currentSpeed?: number;
}

export const CameraPanel: React.FC<CameraPanelProps> = ({
  streamUrl,
  settings,
  isSimulated,
  onFrameCaptured,
  capturedFrame,
  obstacleDistance = null,
  currentSpeed = 160,
}) => {
  const effectiveStreamUrl = streamUrl || settings?.cameraStreamUrl || 'http://192.168.4.1:81/stream';
  const effectiveIsSimulated = isSimulated ?? (settings?.isSimulated || false);
  // Source: 'remote-phone' (relayed from rover phone at /camera), 'local-device', or 'esp32'
  const [activeSource, setActiveSource] = useState<'remote-phone' | 'local-device' | 'esp32'>('remote-phone');

  // Local Device Camera State
  const [phoneStreamActive, setPhoneStreamActive] = useState<boolean>(false);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [phoneStreamError, setPhoneStreamError] = useState<string | null>(null);

  // Remote Phone Relay State (From /api/camera/stream)
  const [remoteSnapshot, setRemoteSnapshot] = useState<PhoneCameraSnapshot | null>(null);
  const [remoteAgeMs, setRemoteAgeMs] = useState<number | null>(null);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [remoteTimestamp, setRemoteTimestamp] = useState<string | null>(null);
  const [remoteDimensions, setRemoteDimensions] = useState<{ width: number; height: number } | null>(null);
  const [remoteHttpStatus, setRemoteHttpStatus] = useState<number | null>(null);
  const [remoteStorageBackend, setRemoteStorageBackend] = useState<string | null>(null);
  const [isRemotePolling, setIsRemotePolling] = useState<boolean>(true);

  // ESP32 Stream State
  const [espStreamKey, setEspStreamKey] = useState<number>(0);
  const [espImgError, setEspImgError] = useState<boolean>(false);
  const [hudVisible, setHudVisible] = useState<boolean>(true);
  const [shutterFlash, setShutterFlash] = useState<boolean>(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  // Clean up local camera tracks cleanly
  const stopLocalCamera = () => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setPhoneStreamActive(false);
  };

  // Start local camera
  const startLocalCamera = async (targetFacing: 'environment' | 'user' = facingMode) => {
    setPhoneStreamError(null);
    if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setPhoneStreamError('MediaDevices API is unsupported or requires HTTPS.');
      return;
    }

    try {
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: { ideal: targetFacing },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      mediaStreamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setPhoneStreamActive(true);
    } catch (err: unknown) {
      stopLocalCamera();
      if (err instanceof DOMException) {
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          setPhoneStreamError('Camera permission was denied in browser site settings.');
        } else if (err.name === 'NotFoundError') {
          setPhoneStreamError(`No physical ${targetFacing === 'environment' ? 'rear' : 'front'} camera detected.`);
        } else if (err.name === 'NotReadableError') {
          setPhoneStreamError('Camera is already in use by another application.');
        } else {
          setPhoneStreamError(`Camera error: ${err.message}`);
        }
      } else {
        setPhoneStreamError('Failed to initialize local camera.');
      }
    }
  };

  const switchCameraFacing = async () => {
    const nextFacing = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(nextFacing);
    if (phoneStreamActive) {
      stopLocalCamera();
      setTimeout(() => startLocalCamera(nextFacing), 150);
    }
  };

  // Remote Phone Relay Polling Loop (/api/camera/stream)
  // Adaptive polling (1500ms interval, pauses when document is hidden)
  useEffect(() => {
    if (activeSource !== 'remote-phone' || !isRemotePolling) return;

    let isMounted = true;
    let pollTimeout: NodeJS.Timeout | null = null;

    const fetchRemoteFrame = async () => {
      // Pause polling when browser tab/window is hidden
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        if (isMounted) {
          pollTimeout = setTimeout(fetchRemoteFrame, 2000);
        }
        return;
      }

      try {
        const res = await fetch('/api/camera/stream');
        if (isMounted) setRemoteHttpStatus(res.status);

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const data = await res.json();

        if (isMounted) {
          setRemoteStorageBackend(data.storageBackend || null);
          if (data.ok && data.hasFrame && data.snapshot) {
            setRemoteSnapshot(data.snapshot);
            setRemoteAgeMs(data.ageMs || 0);
            setRemoteTimestamp(new Date(data.snapshot.timestamp).toLocaleTimeString());
            setRemoteDimensions({
              width: Number(data.snapshot.width) || 1280,
              height: Number(data.snapshot.height) || 720,
            });
            setRemoteError(null);
          } else {
            setRemoteAgeMs(data.ageMs || null);
            if (data.isStale) {
              setRemoteError('Phone camera feed is stale (>10s). Re-open /camera on mobile phone.');
            } else if (!data.hasFrame) {
              setRemoteError(data.message || 'Waiting for mobile camera frames.');
            }
          }
        }
      } catch (err: unknown) {
        if (isMounted) {
          const msg = err instanceof Error ? err.message : 'Network fetch failed';
          setRemoteError(`Relay fetch error: ${msg}`);
        }
      } finally {
        if (isMounted) {
          // Adaptive schedule: 1500ms normal
          pollTimeout = setTimeout(fetchRemoteFrame, 1500);
        }
      }
    };

    fetchRemoteFrame();

    return () => {
      isMounted = false;
      if (pollTimeout) clearTimeout(pollTimeout);
    };
  }, [activeSource, isRemotePolling]);

  // Clean up streams when unmounted
  useEffect(() => {
    return () => {
      stopLocalCamera();
    };
  }, []);

  const refreshEspStream = () => {
    setEspImgError(false);
    setEspStreamKey(Date.now());
  };

  // Capture frame from active camera into offscreen canvas
  const handleCaptureFrame = () => {
    // If remote phone stream is active, capture from remote snapshot
    if (activeSource === 'remote-phone') {
      if (!remoteSnapshot?.dataUrl) return;
      setShutterFlash(true);
      setTimeout(() => setShutterFlash(false), 200);

      const frame: CapturedFrame = {
        dataUrl: remoteSnapshot.dataUrl,
        width: remoteSnapshot.width || 1280,
        height: remoteSnapshot.height || 720,
        timestamp: new Date().toLocaleTimeString(),
      };
      if (onFrameCaptured) {
        onFrameCaptured(frame);
      }
      return;
    }

    // Otherwise capture from local video element
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;

    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, width, height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);

    // Shutter flash effect
    setShutterFlash(true);
    setTimeout(() => setShutterFlash(false), 200);

    const frame: CapturedFrame = {
      dataUrl,
      width,
      height,
      timestamp: new Date().toLocaleTimeString(),
    };

    if (onFrameCaptured) {
      onFrameCaptured(frame);
    }
  };

  return (
    <div className="relative flex flex-col w-full rounded-xl bg-slate-950/90 border border-cyan-500/30 overflow-hidden shadow-2xl">
      {/* Hidden offscreen canvas for local frame capture */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Viewport Top Header & Controls */}
      <div className="flex items-center justify-between px-3 py-2 bg-slate-900/90 border-b border-slate-800 text-xs">
        {/* Source Switcher Tabs */}
        <div className="flex items-center gap-1 p-0.5 bg-slate-950 rounded-lg border border-slate-800">
          <button
            onClick={() => {
              setActiveSource('remote-phone');
              stopLocalCamera();
            }}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md font-mono text-[11px] font-medium transition-all ${
              activeSource === 'remote-phone'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title="Live video feed relayed from mobile phone mounted on rover"
          >
            <Radio className="w-3.5 h-3.5" />
            <span>Rover Phone Cam {remoteSnapshot && '•'}</span>
          </button>

          <button
            onClick={() => {
              setActiveSource('local-device');
            }}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md font-mono text-[11px] font-medium transition-all ${
              activeSource === 'local-device'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title="Local camera on this device"
          >
            <Smartphone className="w-3.5 h-3.5" />
            <span>Local Cam {phoneStreamActive && '•'}</span>
          </button>

          <button
            onClick={() => {
              setActiveSource('esp32');
              stopLocalCamera();
            }}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md font-mono text-[11px] font-medium transition-all ${
              activeSource === 'esp32'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Wifi className="w-3.5 h-3.5" />
            <span>ESP32 Stream</span>
          </button>
        </div>

        {/* Viewport Utilities */}
        <div className="flex items-center gap-1.5">
          {activeSource === 'remote-phone' && (
            <button
              type="button"
              onClick={() => setIsRemotePolling((prev) => !prev)}
              title={isRemotePolling ? 'Pause Remote Polling' : 'Resume Remote Polling'}
              className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-mono border transition-colors ${
                isRemotePolling
                  ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                  : 'bg-slate-900 text-slate-500 border-slate-800'
              }`}
            >
              <RefreshCw className={`w-3 h-3 ${isRemotePolling ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">{isRemotePolling ? 'Live' : 'Paused'}</span>
            </button>
          )}

          {activeSource === 'local-device' && (
            <button
              onClick={switchCameraFacing}
              title={`Switch camera (Currently: ${facingMode === 'environment' ? 'Rear Lens' : 'Front Lens'})`}
              className="flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 text-[11px] font-mono font-medium transition-all active:scale-95"
            >
              <SwitchCamera className="w-3.5 h-3.5 text-cyan-400" />
              <span className="hidden sm:inline">{facingMode === 'environment' ? 'Rear' : 'Front'}</span>
            </button>
          )}

          <button
            onClick={() => setHudVisible(!hudVisible)}
            title="Toggle Tactical HUD Overlays"
            className={`p-1.5 rounded border text-[11px] font-mono transition-colors ${
              hudVisible
                ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30'
                : 'bg-slate-900 text-slate-500 border-slate-800'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
          </button>

          {activeSource === 'esp32' && (
            <button
              onClick={refreshEspStream}
              title="Refresh ESP32 Stream"
              className="p-1.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-cyan-300 border border-slate-800 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          )}

          {activeSource === 'local-device' && (
            <button
              onClick={() => (phoneStreamActive ? stopLocalCamera() : startLocalCamera())}
              className={`flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-mono font-medium transition-colors ${
                phoneStreamActive
                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                  : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
              }`}
            >
              {phoneStreamActive ? (
                <>
                  <VideoOff className="w-3 h-3" /> Stop
                </>
              ) : (
                <>
                  <Camera className="w-3 h-3" /> Start
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Main Video Viewport */}
      <div className="relative aspect-[16/9] w-full bg-black overflow-hidden flex items-center justify-center">
        {/* Shutter Flash Animation */}
        {shutterFlash && (
          <div className="absolute inset-0 bg-white z-30 opacity-70 pointer-events-none transition-opacity duration-150" />
        )}

        {/* View 1: Remote Rover Phone Camera (Relayed via /api/camera/stream) */}
        {activeSource === 'remote-phone' && (
          <div className="relative w-full h-full flex items-center justify-center bg-slate-950">
            {remoteSnapshot ? (
              <img
                src={remoteSnapshot.dataUrl}
                alt="Rover Mobile Camera Feed"
                className="w-full h-full object-contain"
              />
            ) : (
              <div className="flex flex-col items-center justify-center p-6 text-center max-w-md">
                <div className="w-14 h-14 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-400 mb-3">
                  <Radio className="w-7 h-7 text-cyan-400 animate-pulse" />
                </div>
                <h4 className="text-sm font-bold text-slate-200 font-mono tracking-wide">
                  Waiting for Mobile Camera Broadcast
                </h4>
                <p className="text-xs text-slate-400 mt-1 font-mono">
                  Open the dedicated camera broadcaster on your phone mounted on the rover chassis.
                </p>
                <div className="mt-4 flex items-center gap-2">
                  <a
                    href="/camera"
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-mono font-bold shadow-md shadow-cyan-950 transition-all"
                  >
                    <span>Open /camera page</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            )}
          </div>
        )}

        {/* View 2: Local Device Camera */}
        {activeSource === 'local-device' && (
          <div className="relative w-full h-full flex items-center justify-center bg-slate-950">
            <video
              ref={videoRef}
              playsInline
              muted
              className={`w-full h-full object-cover transition-opacity duration-300 ${
                phoneStreamActive ? 'opacity-100' : 'opacity-0 absolute'
              }`}
            />

            {!phoneStreamActive && (
              <div className="flex flex-col items-center justify-center p-6 text-center max-w-md">
                <div className="w-14 h-14 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-400 mb-3">
                  <Camera className="w-7 h-7" />
                </div>
                <h4 className="text-sm font-bold text-slate-200 font-mono tracking-wide">
                  Local Device Camera ({facingMode === 'environment' ? 'Rear Lens' : 'Front Lens'})
                </h4>
                <p className="text-xs text-slate-400 mt-1 font-mono">
                  Use your local laptop or attached webcam for direct vision analysis.
                </p>

                {phoneStreamError && (
                  <div className="flex items-start gap-2 mt-3 p-2.5 rounded bg-rose-950/60 border border-rose-500/40 text-left text-xs text-rose-300 font-mono">
                    <ShieldAlert className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
                    <span>{phoneStreamError}</span>
                  </div>
                )}

                <div className="flex items-center justify-center gap-2 mt-4">
                  <button
                    onClick={() => startLocalCamera()}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white text-xs font-mono font-bold tracking-wide shadow-md shadow-cyan-950 active:scale-95 transition-all"
                  >
                    <Camera className="w-4 h-4" /> Start {facingMode === 'environment' ? 'Rear' : 'Front'} Cam
                  </button>
                  <button
                    onClick={switchCameraFacing}
                    title="Switch camera lens"
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-mono border border-slate-700 active:scale-95 transition-all"
                  >
                    <SwitchCamera className="w-4 h-4 text-cyan-400" />
                    <span>Flip to {facingMode === 'environment' ? 'Front' : 'Rear'}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* View 3: ESP32-CAM MJPEG Stream */}
        {activeSource === 'esp32' && (
          <div className="relative w-full h-full flex items-center justify-center">
            {effectiveIsSimulated ? (
              <div className="relative w-full h-full flex flex-col items-center justify-center bg-gradient-to-b from-slate-900 to-black text-slate-400 p-6 text-center select-none">
                <div className="w-12 h-12 rounded-full bg-cyan-950/40 border border-cyan-500/30 flex items-center justify-center text-cyan-400 mb-2">
                  <Wifi className="w-6 h-6 animate-pulse" />
                </div>
                <h4 className="text-sm font-bold font-mono text-cyan-300 tracking-wide">
                  ESP32 Stream (Simulation Mode)
                </h4>
                <p className="text-xs text-slate-500 mt-1 font-mono">
                  Simulation mode active. Switch to Rover Phone Cam or connect physical hardware.
                </p>
              </div>
            ) : !espImgError ? (
              <img
                key={espStreamKey}
                src={effectiveStreamUrl}
                alt="ESP32 Stream"
                className="w-full h-full object-cover"
                onError={() => setEspImgError(true)}
              />
            ) : (
              <div className="flex flex-col items-center justify-center p-6 text-center max-w-sm">
                <div className="w-12 h-12 rounded-full bg-rose-950/50 border border-rose-500/30 flex items-center justify-center text-rose-400 mb-2">
                  <AlertTriangle className="w-6 h-6" />
                </div>
                <h4 className="text-sm font-bold text-slate-200 font-mono">ESP32 Feed Offline</h4>
                <p className="text-xs text-slate-400 mt-1 font-mono">
                  Could not reach {streamUrl}. Check Wi-Fi connection or switch to Rover Phone Cam.
                </p>
                <button
                  onClick={refreshEspStream}
                  className="mt-3 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-mono text-cyan-300 border border-slate-700"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Reconnect
                </button>
              </div>
            )}
          </div>
        )}

        {/* Tactical HUD Overlay */}
        {hudVisible && (
          <div className="absolute inset-0 pointer-events-none p-3 flex flex-col justify-between">
            {/* Top HUD Badges */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-black/60 backdrop-blur-sm border border-cyan-500/30 text-[10px] font-mono text-cyan-300">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
                <span>
                  SOURCE:{' '}
                  {activeSource === 'remote-phone'
                    ? 'ROVER-PHONE-RELAY'
                    : activeSource === 'local-device'
                    ? `LOCAL-${facingMode.toUpperCase()}`
                    : 'ESP32-STREAM'}
                </span>
              </div>

              {obstacleDistance !== null && (
                <div
                  className={`flex items-center gap-1 px-2 py-0.5 rounded backdrop-blur-sm border text-[10px] font-mono font-bold ${
                    obstacleDistance < 20
                      ? 'bg-rose-950/80 text-rose-300 border-rose-500/60 animate-pulse'
                      : 'bg-black/60 text-slate-300 border-slate-800'
                  }`}
                >
                  {obstacleDistance < 20 && <AlertTriangle className="w-3 h-3 text-rose-400" />}
                  <span>RANGE: {obstacleDistance} cm</span>
                </div>
              )}
            </div>

            {/* Center Crosshair */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="relative w-24 h-24 border border-cyan-400/20 rounded-full flex items-center justify-center">
                <div className="w-2 h-2 rounded-full bg-cyan-400/40" />
                <div className="absolute top-0 w-px h-3 bg-cyan-400/60" />
                <div className="absolute bottom-0 w-px h-3 bg-cyan-400/60" />
                <div className="absolute left-0 h-px w-3 bg-cyan-400/60" />
                <div className="absolute right-0 h-px w-3 bg-cyan-400/60" />
              </div>
            </div>

            {/* Bottom HUD Badges */}
            <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
              <span className="px-2 py-0.5 rounded bg-black/60 backdrop-blur-sm border border-slate-800">
                THROTTLE: {currentSpeed}/255
              </span>
              {activeSource === 'remote-phone' && remoteAgeMs !== null && (
                <span className="px-2 py-0.5 rounded bg-black/60 backdrop-blur-sm border border-slate-800">
                  LATENCY: {remoteAgeMs}ms
                </span>
              )}
              {activeSource === 'local-device' && (
                <span className="px-2 py-0.5 rounded bg-black/60 backdrop-blur-sm border border-slate-800">
                  LENS: {facingMode === 'environment' ? 'BACK/REAR' : 'FRONT/USER'}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Laptop Diagnostic Display for Rover Phone Cam */}
      {activeSource === 'remote-phone' && (
        <div className="px-3 py-1.5 bg-slate-950/90 border-t border-slate-800 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[11px] font-mono">
          <div className="flex items-center gap-3">
            <span className="text-slate-500">
              Frame Time:{' '}
              <strong className={remoteTimestamp ? 'text-slate-200' : 'text-slate-600'}>
                {remoteTimestamp || 'Awaiting stream'}
              </strong>
            </span>

            {remoteDimensions && (
              <span className="text-slate-500">
                Res:{' '}
                <strong className="text-cyan-400">
                  {remoteDimensions.width}x{remoteDimensions.height}
                </strong>
              </span>
            )}

            {remoteAgeMs !== null && (
              <span className="text-slate-500">
                Age:{' '}
                <strong className={remoteAgeMs < 4000 ? 'text-emerald-400' : 'text-amber-400'}>
                  {remoteAgeMs}ms
                </strong>
              </span>
            )}

            {remoteStorageBackend && (
              <span className="text-slate-500">
                Store:{' '}
                <strong className="text-indigo-300">
                  {remoteStorageBackend}
                </strong>
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {remoteError ? (
              <span className="text-rose-400 text-[10px] flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                <span>{remoteError}</span>
              </span>
            ) : remoteSnapshot ? (
              <span className="text-emerald-400 text-[10px] flex items-center gap-1">
                <Check className="w-3 h-3" />
                <span>Frame rendered (HTTP {remoteHttpStatus || 200})</span>
              </span>
            ) : (
              <span className="text-amber-400 text-[10px]">
                {remoteHttpStatus ? `HTTP ${remoteHttpStatus}` : 'Polling relay...'}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Frame Capture Action Bar */}
      <div className="px-3 py-2 bg-slate-900 border-t border-slate-800 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleCaptureFrame}
            disabled={activeSource === 'remote-phone' ? !remoteSnapshot : !phoneStreamActive && activeSource !== 'esp32'}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-mono text-xs font-bold shadow-md shadow-cyan-950 active:scale-95 transition-all"
          >
            <Camera className="w-3.5 h-3.5" />
            <span>Capture Frame for Gemini</span>
          </button>

          {activeSource === 'local-device' && phoneStreamActive && (
            <button
              type="button"
              onClick={switchCameraFacing}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-mono font-medium active:scale-95 transition-all"
              title="Flip to Front/Rear camera"
            >
              <SwitchCamera className="w-3.5 h-3.5 text-cyan-400" />
              <span>Flip ({facingMode === 'environment' ? 'Rear' : 'Front'})</span>
            </button>
          )}

          {capturedFrame && (
            <span className="hidden sm:flex items-center gap-1 text-[11px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded border border-emerald-500/20">
              <Check className="w-3 h-3" />
              Snapshot Ready
            </span>
          )}
        </div>

        <div className="text-[10px] font-mono text-slate-500 hidden md:block">
          {activeSource === 'remote-phone'
            ? 'Relayed Mobile Snapshot (Low-rate live preview)'
            : activeSource === 'local-device'
            ? 'Local Browser MediaStream'
            : 'ESP32 Wi-Fi MJPEG Stream'}
        </div>
      </div>
    </div>
  );
};
