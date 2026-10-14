'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Video,
  VideoOff,
  Smartphone,
  Wifi,
  RefreshCw,
  AlertTriangle,
  Camera,
  Layers,
  ShieldAlert,
  Sparkles,
  Check,
} from 'lucide-react';
import { RobotSettings, CapturedFrame } from '@/types/robot';

interface CameraPanelProps {
  settings: RobotSettings;
  obstacleDistance: number | null;
  currentSpeed: number;
  capturedFrame?: CapturedFrame | null;
  onFrameCaptured?: (frame: CapturedFrame) => void;
}

export const CameraPanel: React.FC<CameraPanelProps> = ({
  settings,
  obstacleDistance,
  currentSpeed,
  capturedFrame,
  onFrameCaptured,
}) => {
  const [activeSource, setActiveSource] = useState<'esp32' | 'phone'>('esp32');
  const [phoneStreamActive, setPhoneStreamActive] = useState<boolean>(false);
  const [phoneStreamError, setPhoneStreamError] = useState<string | null>(null);
  const [espStreamKey, setEspStreamKey] = useState<number>(0);
  const [espImgError, setEspImgError] = useState<boolean>(false);
  const [hudVisible, setHudVisible] = useState<boolean>(true);
  const [shutterFlash, setShutterFlash] = useState<boolean>(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  // Stop phone camera tracks cleanly
  const stopPhoneCamera = () => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => {
        track.stop();
      });
      mediaStreamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setPhoneStreamActive(false);
  };

  // Start smartphone rear camera preview using getUserMedia
  const startPhoneCamera = async () => {
    setPhoneStreamError(null);

    if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setPhoneStreamError(
        'MediaDevices API is unsupported or blocked by an insecure context (HTTP). Please run over HTTPS or localhost.'
      );
      return;
    }

    try {
      // Request rear camera by default with optimal mobile constraints
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false, // Mic is requested separately when user engages voice
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      mediaStreamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setPhoneStreamActive(true);
    } catch (err: unknown) {
      stopPhoneCamera();
      if (err instanceof DOMException) {
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          setPhoneStreamError('Camera permission was denied. Allow camera access in browser site settings.');
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
          setPhoneStreamError('No physical camera device detected on this device.');
        } else if (err.name === 'NotReadableError') {
          setPhoneStreamError('Camera is already in use by another application.');
        } else {
          setPhoneStreamError(`Camera error: ${err.message}`);
        }
      } else {
        setPhoneStreamError('Failed to initialize phone camera.');
      }
    }
  };

  // Clean up streams when component unmounts or when switching away
  useEffect(() => {
    return () => {
      stopPhoneCamera();
    };
  }, []);

  const refreshEspStream = () => {
    setEspImgError(false);
    setEspStreamKey(Date.now());
  };

  // Capture frame from the active rear camera video element into canvas
  const handleCaptureFrame = () => {
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
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    };

    if (onFrameCaptured) {
      onFrameCaptured(frame);
    }
  };

  return (
    <div className="relative flex flex-col w-full rounded-xl bg-slate-950/90 border border-cyan-500/30 overflow-hidden shadow-2xl">
      {/* Hidden offscreen canvas for frame capture */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Viewport Top Header & Controls */}
      <div className="flex items-center justify-between px-3 py-2 bg-slate-900/90 border-b border-slate-800 text-xs">
        {/* Source Switcher Tabs */}
        <div className="flex items-center gap-1 p-0.5 bg-slate-950 rounded-lg border border-slate-800">
          <button
            onClick={() => {
              setActiveSource('esp32');
            }}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md font-mono text-[11px] font-medium transition-all ${
              activeSource === 'esp32'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Wifi className="w-3.5 h-3.5" />
            <span>ESP32-CAM</span>
          </button>

          <button
            onClick={() => {
              setActiveSource('phone');
            }}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md font-mono text-[11px] font-medium transition-all ${
              activeSource === 'phone'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Smartphone className="w-3.5 h-3.5" />
            <span>Phone Cam {phoneStreamActive && '•'}</span>
          </button>
        </div>

        {/* Viewport Utilities */}
        <div className="flex items-center gap-1.5">
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

          {activeSource === 'esp32' ? (
            <button
              onClick={refreshEspStream}
              title="Refresh ESP32 Stream"
              className="p-1.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-cyan-300 border border-slate-800 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              onClick={phoneStreamActive ? stopPhoneCamera : startPhoneCamera}
              className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-mono font-medium transition-colors ${
                phoneStreamActive
                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                  : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
              }`}
            >
              {phoneStreamActive ? (
                <>
                  <VideoOff className="w-3 h-3" /> Stop Cam
                </>
              ) : (
                <>
                  <Camera className="w-3 h-3" /> Start Cam
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Main Video Viewport */}
      <div className="relative w-full aspect-video sm:aspect-[16/10] bg-slate-950 flex items-center justify-center overflow-hidden">
        {/* Shutter Flash Animation */}
        {shutterFlash && (
          <div className="absolute inset-0 bg-white/70 z-30 pointer-events-none transition-opacity duration-150" />
        )}

        {/* Source 1: ESP32-CAM */}
        {activeSource === 'esp32' && (
          <div className="relative w-full h-full flex items-center justify-center bg-black">
            {!settings.isSimulated && !espImgError ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                key={espStreamKey}
                src={`${settings.cameraStreamUrl}?t=${espStreamKey}`}
                alt="ESP32-CAM Live Video Stream"
                className="w-full h-full object-contain"
                onError={() => setEspImgError(true)}
              />
            ) : (
              /* Simulated / Hardware Standby View */
              <div className="flex flex-col items-center justify-center p-6 text-center max-w-md">
                <div className="w-14 h-14 rounded-full bg-cyan-950/60 border border-cyan-500/30 flex items-center justify-center text-cyan-400 mb-3 shadow-inner">
                  <Video className="w-7 h-7 animate-pulse" />
                </div>
                <h4 className="text-sm font-bold text-slate-200 font-mono tracking-wide uppercase">
                  {settings.isSimulated
                    ? 'ESP32 Stream: Simulation Mode'
                    : 'ESP32-CAM Stream Standby'}
                </h4>
                <p className="text-xs text-slate-400 mt-1 font-mono">
                  {settings.isSimulated
                    ? 'Switch to "Phone Cam" tab to capture frames with your phone camera for Gemini Vision!'
                    : `Connecting to ${settings.cameraStreamUrl}. Verify ESP32-CAM power, Wi-Fi connection, and IP.`}
                </p>
                <div className="flex gap-2 mt-4">
                  <button
                    onClick={refreshEspStream}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-mono text-cyan-300"
                  >
                    <RefreshCw className="w-3.5 h-3.5" /> Retry Stream
                  </button>
                  <button
                    onClick={() => {
                      setActiveSource('phone');
                      startPhoneCamera();
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-600/20 hover:bg-cyan-600/30 border border-cyan-500/40 text-xs font-mono text-cyan-200"
                  >
                    <Smartphone className="w-3.5 h-3.5" /> Use Phone Cam
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Source 2: Phone Camera (Rear Camera by default) */}
        {activeSource === 'phone' && (
          <div className="relative w-full h-full flex items-center justify-center bg-black">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`w-full h-full object-cover ${!phoneStreamActive ? 'hidden' : ''}`}
            />

            {!phoneStreamActive && (
              <div className="flex flex-col items-center justify-center p-6 text-center max-w-md">
                <div className="w-14 h-14 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-400 mb-3">
                  <Camera className="w-7 h-7" />
                </div>
                <h4 className="text-sm font-bold text-slate-200 font-mono tracking-wide">
                  Smartphone Camera Viewport
                </h4>
                <p className="text-xs text-slate-400 mt-1 font-mono">
                  Provides high-resolution vision feed for Gemini AI navigation and obstacle inspection.
                </p>

                {phoneStreamError && (
                  <div className="flex items-start gap-2 mt-3 p-2.5 rounded bg-rose-950/60 border border-rose-500/40 text-left text-xs text-rose-300 font-mono">
                    <ShieldAlert className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
                    <span>{phoneStreamError}</span>
                  </div>
                )}

                <button
                  onClick={startPhoneCamera}
                  className="mt-4 flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white text-xs font-mono font-bold tracking-wide shadow-md shadow-cyan-950 active:scale-95 transition-all"
                >
                  <Camera className="w-4 h-4" /> Enable Rear Camera
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
                  SOURCE: {activeSource === 'esp32' ? 'ESP32-CAM' : 'PHONE-REAR'}
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

            {/* Center Reticle / Crosshair */}
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
              <span className="px-2 py-0.5 rounded bg-black/60 backdrop-blur-sm border border-slate-800">
                FPS: ~30 • AUTO-EXP
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Frame Capture Action Bar (Visible when Phone Camera is Active) */}
      {activeSource === 'phone' && phoneStreamActive && (
        <div className="px-3 py-2 bg-slate-900 border-t border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCaptureFrame}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-mono text-xs font-bold shadow-md shadow-cyan-950 active:scale-95 transition-all"
            >
              <Camera className="w-3.5 h-3.5" />
              <span>Capture Frame for Gemini AI</span>
            </button>

            {capturedFrame && (
              <span className="flex items-center gap-1 text-[11px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded border border-emerald-500/20">
                <Check className="w-3 h-3" />
                Frame Snapshot Ready
              </span>
            )}
          </div>

          <div className="text-[10px] font-mono text-slate-500 hidden sm:block">
            Rear 720p HD Feed
          </div>
        </div>
      )}
    </div>
  );
};
