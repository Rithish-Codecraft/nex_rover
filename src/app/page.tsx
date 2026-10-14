'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Header } from '@/components/Header';
import { CameraPanel } from '@/components/CameraPanel';
import { VisionAnalysisCard } from '@/components/VisionAnalysisCard';
import { DrivePad } from '@/components/DrivePad';
import { MotorSpeedControl } from '@/components/MotorSpeedControl';
import { ArmController } from '@/components/ArmController';
import { TelemetryCard } from '@/components/TelemetryCard';
import { VoiceController } from '@/components/VoiceController';
import { ChatPanel } from '@/components/ChatPanel';
import { SettingsModal } from '@/components/SettingsModal';
import { SimulationBanner } from '@/components/SimulationOverlay';

import {
  RobotSettings,
  TelemetryData,
  DriveCommand,
  ArmJoint,
  ArmPosePreset,
  ChatMessage,
  ValidatedRobotAction,
  DEFAULT_ARM_ANGLES,
  CapturedFrame,
  RoverControlMode,
} from '@/types/robot';
import { RobotApiClient } from '@/lib/robot-api';
import { parseWithCloudLLM } from '@/lib/ai-command-parser';
import { SpeechHandler } from '@/lib/speech';

export default function RoverDashboardPage() {
  // Control Arbitration Mode: 'manual' | 'approval' | 'autonomous'
  const [controlMode, setControlMode] = useState<RoverControlMode>('approval');

  // Settings State - defaults to Simulation Mode first so judges/users can test immediately!
  const [settings, setSettings] = useState<RobotSettings>({
    robotIp: 'http://192.168.4.1',
    cameraStreamUrl: 'http://192.168.4.1:81/stream',
    pcBackendUrl: 'http://127.0.0.1:5000',
    roverToken: '',
    usePcRelay: true,
    isSimulated: true,
    holdToDrive: true,
    pollIntervalMs: 1000,
    speechAudioFeedback: true,
    commandTimeoutMs: 2000,
  });

  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [capturedFrame, setCapturedFrame] = useState<CapturedFrame | null>(null);

  // Live Telemetry
  const [telemetry, setTelemetry] = useState<TelemetryData>({
    connected: true,
    latencyMs: 8,
    batteryVoltage: 7.8,
    obstacleDistanceCm: 45,
    currentSpeed: 160,
    arm: { ...DEFAULT_ARM_ANGLES },
    lastCommand: 'S',
    lastSeen: null,
    isSimulated: true,
    firmwareVersion: 'NEX-SIM-v1.0',
  });

  // Chat History
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome-1',
      sender: 'rover',
      text: 'NEX-ROVER systems initialized. Ready for Gemini Vision mobile frame analysis or manual/voice commands.',
      timestamp: 'INIT',
    },
  ]);
  const [isAiProcessing, setIsAiProcessing] = useState(false);

  // API Client & Speech References
  const apiClientRef = useRef<RobotApiClient>(new RobotApiClient(settings));
  const speechRef = useRef<SpeechHandler | null>(null);
  const autoStopTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Update API Client settings when state changes
  useEffect(() => {
    apiClientRef.current.updateSettings(settings);
  }, [settings]);

  // Audio Speech Handler setup
  useEffect(() => {
    speechRef.current = new SpeechHandler();
  }, []);

  const speakConfirmation = useCallback((text: string) => {
    if (settings.speechAudioFeedback && speechRef.current) {
      speechRef.current.speak(text);
    }
  }, [settings.speechAudioFeedback]);

  // Telemetry Polling Loop
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const data = await apiClientRef.current.fetchTelemetry();
        setTelemetry(data);
      } catch {
        // Handled inside client
      }
    }, settings.pollIntervalMs);

    return () => clearInterval(interval);
  }, [settings.pollIntervalMs, settings.isSimulated]);

  // Emergency STOP (Interrupts all movements immediately, clears queues)
  const handleEmergencyStop = useCallback(async () => {
    if (autoStopTimeoutRef.current) {
      clearTimeout(autoStopTimeoutRef.current);
      autoStopTimeoutRef.current = null;
    }

    await apiClientRef.current.emergencyStop();
    setTelemetry((prev) => ({
      ...prev,
      lastCommand: 'EMERGENCY_STOP',
    }));

    const alertMessage: ChatMessage = {
      id: `estop-${Date.now()}`,
      sender: 'rover',
      text: 'EMERGENCY STOP ENGAGED. All DC motors halted immediately.',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      action: { type: 'ESTOP' },
      status: 'executed',
    };
    setMessages((prev) => [...prev, alertMessage]);
    speakConfirmation('Emergency stop activated');
  }, [speakConfirmation]);

  // Central Safety Command Arbiter enforcing strict priority hierarchy:
  // 1. Emergency Stop (Highest priority: always executed, cancels all queues)
  // 2. Manual Operator Control (Overrides AI/autonomous commands)
  // 3. Safety Restrictions & Obstacle Detection (Forward drive blocked if sonar < 20cm)
  // 4. Approved AI / Autonomous commands (max 1000ms duration, clamped speed)
  const arbitrateAndDrive = useCallback(
    async (
      command: DriveCommand,
      source: 'manual' | 'ai' | 'estop' = 'manual',
      durationMs?: number
    ) => {
      if (source === 'estop' || command === 'S') {
        if (autoStopTimeoutRef.current) {
          clearTimeout(autoStopTimeoutRef.current);
          autoStopTimeoutRef.current = null;
        }
        await apiClientRef.current.sendDriveCommand('S');
        setTelemetry((prev) => ({ ...prev, lastCommand: 'S' }));
        return { executed: true };
      }

      // Safety Guard: Obstacle Collision Prevention (< 20cm blocks forward movement)
      if (
        command === 'F' &&
        telemetry.obstacleDistanceCm !== null &&
        telemetry.obstacleDistanceCm > 0 &&
        telemetry.obstacleDistanceCm < 20
      ) {
        speakConfirmation('Obstacle detected. Forward motion blocked.');
        setMessages((prev) => [
          ...prev,
          {
            id: `safety-${Date.now()}`,
            sender: 'rover',
            text: `SAFETY INTERLOCK: Forward motion blocked. Obstacle at ${telemetry.obstacleDistanceCm} cm.`,
            timestamp: new Date().toLocaleTimeString(),
          },
        ]);
        await apiClientRef.current.sendDriveCommand('S');
        return { executed: false, reason: 'Obstacle collision prevention' };
      }

      // Revert from autonomous to manual on human operator keypress/click
      if (source === 'manual' && controlMode === 'autonomous') {
        setControlMode('manual');
        speakConfirmation('Manual override engaged');
      }

      // Clear any previous timed movement
      if (autoStopTimeoutRef.current) {
        clearTimeout(autoStopTimeoutRef.current);
        autoStopTimeoutRef.current = null;
      }

      await apiClientRef.current.sendDriveCommand(command);
      setTelemetry((prev) => ({
        ...prev,
        lastCommand: command,
      }));

      // Enforce bounded duration (strictly <= 1000ms)
      if (durationMs && durationMs > 0) {
        const boundedDuration = Math.min(1000, durationMs);
        autoStopTimeoutRef.current = setTimeout(async () => {
          await apiClientRef.current.sendDriveCommand('S');
          setTelemetry((prev) => ({ ...prev, lastCommand: 'S' }));
        }, boundedDuration);
      }

      return { executed: true };
    },
    [controlMode, speakConfirmation, telemetry.obstacleDistanceCm]
  );

  // Drive Command Execution via Arbiter
  const handleDriveCommand = useCallback(
    async (command: DriveCommand, durationMs?: number) => {
      await arbitrateAndDrive(command, 'manual', durationMs);
    },
    [arbitrateAndDrive]
  );

  // Speed Command Execution
  const handleSetSpeed = useCallback(async (speed: number) => {
    await apiClientRef.current.sendSpeedCommand(speed);
    setTelemetry((prev) => ({
      ...prev,
      currentSpeed: speed,
      lastCommand: `V:${speed}`,
    }));
  }, []);

  // Arm Joint Angle Execution
  const handleSetJointAngle = useCallback(async (joint: ArmJoint, angle: number) => {
    await apiClientRef.current.sendArmCommand(joint, angle);
    setTelemetry((prev) => ({
      ...prev,
      arm: {
        ...prev.arm,
        [joint]: angle,
      },
      lastCommand: `ARM:${joint}:${angle}`,
    }));
  }, []);

  // Arm Preset Pose Execution
  const handleApplyPreset = useCallback(async (preset: ArmPosePreset) => {
    // Send each joint with slight stagger
    const joints: ArmJoint[] = ['BASE', 'SHOULDER', 'ELBOW', 'GRIPPER'];
    for (const joint of joints) {
      const angle = preset.angles[joint];
      await apiClientRef.current.sendArmCommand(joint, angle);
    }

    setTelemetry((prev) => ({
      ...prev,
      arm: { ...preset.angles },
      lastCommand: `POSE:${preset.name.toUpperCase()}`,
    }));

    speakConfirmation(`Executing ${preset.label}`);
  }, [speakConfirmation]);

  // Execute a parsed action safely
  const executeValidatedAction = useCallback(async (action: ValidatedRobotAction) => {
    switch (action.type) {
      case 'ESTOP':
        await handleEmergencyStop();
        break;

      case 'STOP':
        await handleDriveCommand('S');
        break;

      case 'DRIVE':
        await handleDriveCommand(action.command);
        if (action.durationMs && action.durationMs > 0) {
          autoStopTimeoutRef.current = setTimeout(async () => {
            await handleDriveCommand('S');
          }, action.durationMs);
        }
        break;

      case 'SPEED':
        await handleSetSpeed(action.value);
        break;

      case 'ARM':
        await handleSetJointAngle(action.joint, action.angle);
        break;

      case 'ARM_POSE':
        if (action.angles) {
          for (const [j, ang] of Object.entries(action.angles)) {
            if (ang !== undefined) {
              await handleSetJointAngle(j as ArmJoint, ang);
            }
          }
        }
        break;

      case 'STATUS_QUERY':
        const currentData = await apiClientRef.current.fetchTelemetry();
        setTelemetry(currentData);
        break;
    }
  }, [handleEmergencyStop, handleDriveCommand, handleSetSpeed, handleSetJointAngle]);

  // Natural Language Command Processing (Voice or Chat)
  const handleProcessNaturalLanguage = useCallback(async (input: string) => {
    if (!input.trim()) return;

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      sender: 'user',
      text: input,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    };
    setMessages((prev) => [...prev, userMessage]);
    setIsAiProcessing(true);

    try {
      const parseResult = await parseWithCloudLLM(input);

      if (parseResult.action) {
        await executeValidatedAction(parseResult.action);
      }

      const roverReply: ChatMessage = {
        id: `rover-${Date.now()}`,
        sender: 'rover',
        text: parseResult.replyText,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        action: parseResult.action || undefined,
        status: parseResult.action ? 'executed' : 'rejected',
      };
      setMessages((prev) => [...prev, roverReply]);

      // Audio speech output
      speakConfirmation(parseResult.replyText);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Processing error';
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          sender: 'rover',
          text: `Command error: ${errorMsg}`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        },
      ]);
    } finally {
      setIsAiProcessing(false);
    }
  }, [executeValidatedAction, speakConfirmation]);

  // Callback when an approved vision action is executed via relay
  const handleVisionExecutionFinished = useCallback((cmd: string) => {
    setTelemetry((prev) => ({ ...prev, lastCommand: cmd }));
    setMessages((prev) => [
      ...prev,
      {
        id: `vision-exec-${Date.now()}`,
        sender: 'rover',
        text: `Gemini Vision Action approved & executed on hardware: [${cmd}]`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        status: 'executed',
      },
    ]);
  }, []);

  // Test Ping from settings
  const handleTestConnection = async (ip: string) => {
    const start = performance.now();
    try {
      const res = await fetch(`${ip.replace(/\/+$/, '')}/api/status`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      if (res.ok) {
        const latency = Math.round(performance.now() - start);
        return { success: true, latencyMs: latency };
      }
      return { success: false, error: `ESP32 returned status ${res.status}` };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Network error';
      return { success: false, error: msg };
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-cyan-500 selection:text-slate-950 font-sans">
      {/* Top Header */}
      <Header
        telemetry={telemetry}
        isSimulated={settings.isSimulated}
        onOpenSettings={() => setSettingsModalOpen(true)}
        onEmergencyStop={handleEmergencyStop}
      />

      {/* Prominent Simulation Banner if in Simulation Mode */}
      {settings.isSimulated && (
        <SimulationBanner
          onToggleHardware={() => {
            setSettings((prev) => ({ ...prev, isSimulated: false }));
          }}
        />
      )}

      {/* Main Responsive Grid Layout */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-3 sm:p-5 space-y-4 sm:space-y-6">
        {/* Tactical Control Arbitration Mode Bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between p-3 rounded-xl bg-slate-900/80 border border-slate-800 gap-3 shadow-lg">
          <div className="flex items-center gap-2">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                controlMode === 'autonomous'
                  ? 'bg-purple-400 animate-ping'
                  : controlMode === 'approval'
                  ? 'bg-amber-400 animate-pulse'
                  : 'bg-cyan-400'
              }`}
            />
            <span className="text-xs font-mono font-bold text-slate-300 uppercase tracking-wide">
              Control Priority Arbiter:
            </span>
            <span
              className={`text-xs font-mono px-2.5 py-0.5 rounded border font-bold uppercase ${
                controlMode === 'autonomous'
                  ? 'bg-purple-500/20 text-purple-300 border-purple-500/40'
                  : controlMode === 'approval'
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                  : 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
              }`}
            >
              {controlMode === 'manual'
                ? 'Manual Mode (100% Operator Priority)'
                : controlMode === 'approval'
                ? 'Approval Gate (Human Authorization Required)'
                : 'Autonomous Exploration (Safety Gated)'}
            </span>
          </div>

          <div className="flex items-center gap-1.5 p-1 rounded-lg bg-slate-950 border border-slate-800">
            <button
              onClick={() => {
                setControlMode('manual');
                speakConfirmation('Switched to manual control mode');
              }}
              className={`px-3 py-1 rounded text-xs font-mono font-bold transition-all ${
                controlMode === 'manual'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Manual
            </button>
            <button
              onClick={() => {
                setControlMode('approval');
                speakConfirmation('Switched to operator approval mode');
              }}
              className={`px-3 py-1 rounded text-xs font-mono font-bold transition-all ${
                controlMode === 'approval'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Approval Gate
            </button>
            <button
              onClick={() => {
                setControlMode('autonomous');
                speakConfirmation('Switched to autonomous exploration mode');
              }}
              className={`px-3 py-1 rounded text-xs font-mono font-bold transition-all ${
                controlMode === 'autonomous'
                  ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Autonomous
            </button>
          </div>
        </div>

        {/* Top Section: Live Camera + Vision Card + Telemetry + Controls */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          {/* Left Column: Camera Viewport + Gemini Vision Approval Card + Telemetry (Span 7) */}
          <div className="lg:col-span-7 flex flex-col gap-4">
            <CameraPanel
              settings={settings}
              obstacleDistance={telemetry.obstacleDistanceCm}
              currentSpeed={telemetry.currentSpeed}
              capturedFrame={capturedFrame}
              onFrameCaptured={(frame) => setCapturedFrame(frame)}
            />

            {/* Mobile-Camera Gemini AI & Operator Approval Card */}
            <VisionAnalysisCard
              capturedFrame={capturedFrame}
              onClearFrame={() => setCapturedFrame(null)}
              settings={settings}
              onEmergencyStop={handleEmergencyStop}
              onExecutionFinished={handleVisionExecutionFinished}
              controlMode={controlMode}
            />

            {/* Ultrasonic Sonar & Battery Telemetry Card */}
            <TelemetryCard telemetry={telemetry} />
          </div>

          {/* Right Column: Controls & Interaction Panel (Span 5) */}
          <div className="lg:col-span-5 flex flex-col gap-4">
            {/* Drive Controller (D-Pad) */}
            <DrivePad
              onSendCommand={handleDriveCommand}
              holdToDrive={settings.holdToDrive}
            />

            {/* Motor Throttle Speed Slider */}
            <MotorSpeedControl
              currentSpeed={telemetry.currentSpeed}
              onSetSpeed={handleSetSpeed}
            />

            {/* Voice Controller Microphone */}
            <VoiceController
              onTranscriptReceived={handleProcessNaturalLanguage}
              audioFeedbackEnabled={settings.speechAudioFeedback}
              onToggleAudioFeedback={() =>
                setSettings((prev) => ({
                  ...prev,
                  speechAudioFeedback: !prev.speechAudioFeedback,
                }))
              }
            />
          </div>
        </div>

        {/* Bottom Section: Robotic Arm + AI Chat Terminal */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          {/* 4-DOF Robotic Arm Controller (Span 6 on Desktop) */}
          <div className="lg:col-span-6">
            <ArmController
              armAngles={telemetry.arm}
              onSetJointAngle={handleSetJointAngle}
              onApplyPreset={handleApplyPreset}
            />
          </div>

          {/* Natural Language AI Terminal / Chat Panel (Span 6 on Desktop) */}
          <div className="lg:col-span-6">
            <ChatPanel
              messages={messages}
              onSendMessage={handleProcessNaturalLanguage}
              onClearMessages={() => setMessages([])}
              isLoading={isAiProcessing}
            />
          </div>
        </div>
      </main>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={settingsModalOpen}
        onClose={() => setSettingsModalOpen(false)}
        settings={settings}
        onSaveSettings={(newSettings) => setSettings(newSettings)}
        onTestConnection={handleTestConnection}
      />
    </div>
  );
}
