'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Radio,
  AlertCircle,
  Sparkles,
} from 'lucide-react';
import {
  SpeechHandler,
  isSpeechRecognitionSupported,
  isSpeechSynthesisSupported,
} from '@/lib/speech';

interface VoiceControllerProps {
  onTranscriptReceived: (transcript: string) => void;
  audioFeedbackEnabled: boolean;
  onToggleAudioFeedback: () => void;
}

export const VoiceController: React.FC<VoiceControllerProps> = ({
  onTranscriptReceived,
  audioFeedbackEnabled,
  onToggleAudioFeedback,
}) => {
  const [isListening, setIsListening] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastTranscript, setLastTranscript] = useState<string | null>(null);
  const [isSpeechSupported, setIsSpeechSupported] = useState<boolean>(false);

  const speechHandlerRef = useRef<SpeechHandler | null>(null);

  useEffect(() => {
    setIsSpeechSupported(isSpeechRecognitionSupported());
    const handler = new SpeechHandler();
    handler.setCallbacks({
      onResult: (transcript) => {
        setLastTranscript(transcript);
        setErrorMessage(null);
        onTranscriptReceived(transcript);
      },
      onError: (err) => {
        setErrorMessage(err);
      },
      onStateChange: (listening) => {
        setIsListening(listening);
      },
    });

    speechHandlerRef.current = handler;

    return () => {
      handler.stopListening();
    };
  }, [onTranscriptReceived]);

  const toggleListening = () => {
    setErrorMessage(null);
    if (!speechHandlerRef.current) return;

    if (isListening) {
      speechHandlerRef.current.stopListening();
    } else {
      speechHandlerRef.current.startListening();
    }
  };

  return (
    <div className="flex flex-col p-4 rounded-xl bg-slate-950/80 border border-cyan-500/25 shadow-xl">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
          <Radio className="w-3.5 h-3.5 text-cyan-400" />
          Voice Interaction & Audio
        </span>

        <button
          onClick={onToggleAudioFeedback}
          title={audioFeedbackEnabled ? 'Robot Audio Speech synthesis enabled' : 'Muted'}
          className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-mono transition-colors border ${
            audioFeedbackEnabled
              ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30'
              : 'bg-slate-900 text-slate-500 border-slate-800'
          }`}
        >
          {audioFeedbackEnabled ? (
            <>
              <Volume2 className="w-3.5 h-3.5" />
              <span>Voice ON</span>
            </>
          ) : (
            <>
              <VolumeX className="w-3.5 h-3.5" />
              <span>Muted</span>
            </>
          )}
        </button>
      </div>

      <div className="flex items-center gap-4">
        {/* Main Microphone Action Button */}
        <button
          onClick={toggleListening}
          disabled={!isSpeechSupported}
          className={`relative flex items-center justify-center w-14 h-14 rounded-full transition-all active:scale-95 shadow-lg ${
            !isSpeechSupported
              ? 'bg-slate-800 text-slate-600 border border-slate-700 cursor-not-allowed'
              : isListening
              ? 'bg-gradient-to-tr from-rose-600 to-red-500 text-white shadow-rose-950 glow-red animate-pulse'
              : 'bg-gradient-to-tr from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white shadow-cyan-950/60 glow-cyan'
          }`}
          aria-label={isListening ? 'Stop listening' : 'Start voice command'}
        >
          {isListening ? (
            <Mic className="w-7 h-7 animate-bounce" />
          ) : isSpeechSupported ? (
            <Mic className="w-7 h-7" />
          ) : (
            <MicOff className="w-7 h-7" />
          )}

          {isListening && (
            <span className="absolute -inset-1 rounded-full border-2 border-red-500/50 animate-ping pointer-events-none" />
          )}
        </button>

        {/* Status / Transcript Area */}
        <div className="flex-1">
          {isListening ? (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-mono font-bold text-rose-400">
                <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
                LISTENING FOR COMMAND...
              </div>
              <p className="text-[11px] text-slate-400 font-mono">
                Speak: &quot;Move forward&quot;, &quot;Turn left&quot;, &quot;Park arm&quot;, &quot;Stop&quot;
              </p>
            </div>
          ) : lastTranscript ? (
            <div className="space-y-0.5">
              <span className="text-[10px] font-mono text-cyan-400 uppercase tracking-wide flex items-center gap-1">
                <Sparkles className="w-3 h-3" /> Last Heard:
              </span>
              <p className="text-xs font-mono text-slate-200 bg-slate-900/80 px-2 py-1 rounded border border-slate-800">
                &ldquo;{lastTranscript}&rdquo;
              </p>
            </div>
          ) : (
            <div>
              <p className="text-xs font-mono font-medium text-slate-300">
                {isSpeechSupported ? 'Tap mic to issue voice commands' : 'Speech recognition unavailable'}
              </p>
              <p className="text-[11px] font-mono text-slate-500">
                {isSpeechSupported
                  ? 'Transcribes speech directly via Web Speech API'
                  : 'Requires Google Chrome, MS Edge, or modern mobile browser.'}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Error Message Alert */}
      {errorMessage && (
        <div className="mt-3 flex items-start gap-2 p-2 rounded bg-rose-950/60 border border-rose-500/40 text-[11px] text-rose-300 font-mono">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
          <span>{errorMessage}</span>
        </div>
      )}
    </div>
  );
};
