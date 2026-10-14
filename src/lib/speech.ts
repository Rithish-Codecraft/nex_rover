// Speech Recognition & Speech Synthesis Utility

// Browser declaration types for webkitSpeechRecognition
export interface IWindowWithSpeech extends Window {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  SpeechRecognition?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  webkitSpeechRecognition?: any;
}

export interface SpeechRecognitionResultItem {
  transcript: string;
  confidence: number;
}

export function isSpeechRecognitionSupported(): boolean {
  if (typeof window === 'undefined') return false;
  const win = window as unknown as IWindowWithSpeech;
  return Boolean(win.SpeechRecognition || win.webkitSpeechRecognition);
}

export function isSpeechSynthesisSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
}

export function isSecureContext(): boolean {
  if (typeof window === 'undefined') return true;
  return window.isSecureContext || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
}

export class SpeechHandler {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private recognition: any = null;
  private isListening = false;
  private onResultCallback: ((transcript: string) => void) | null = null;
  private onErrorCallback: ((error: string) => void) | null = null;
  private onStateChangeCallback: ((listening: boolean) => void) | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      const win = window as unknown as IWindowWithSpeech;
      const SpeechRec = win.SpeechRecognition || win.webkitSpeechRecognition;
      if (SpeechRec) {
        this.recognition = new SpeechRec();
        this.recognition.continuous = false;
        this.recognition.interimResults = false;
        this.recognition.lang = 'en-US';

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.recognition.onresult = (event: any) => {
          if (event.results && event.results.length > 0) {
            const transcript = event.results[0][0].transcript;
            if (this.onResultCallback) {
              this.onResultCallback(transcript);
            }
          }
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.recognition.onerror = (event: any) => {
          this.isListening = false;
          if (this.onStateChangeCallback) this.onStateChangeCallback(false);
          let errText = 'Speech recognition error';
          if (event.error === 'not-allowed' || event.error === 'permission-denied') {
            errText = 'Microphone permission denied. Please allow microphone access in browser settings.';
          } else if (event.error === 'no-speech') {
            errText = 'No speech detected. Please speak clearly into the microphone.';
          } else if (event.error === 'network') {
            errText = 'Speech service network error.';
          }
          if (this.onErrorCallback) this.onErrorCallback(errText);
        };

        this.recognition.onend = () => {
          this.isListening = false;
          if (this.onStateChangeCallback) this.onStateChangeCallback(false);
        };
      }
    }
  }

  setCallbacks({
    onResult,
    onError,
    onStateChange,
  }: {
    onResult: (transcript: string) => void;
    onError: (error: string) => void;
    onStateChange: (listening: boolean) => void;
  }) {
    this.onResultCallback = onResult;
    this.onErrorCallback = onError;
    this.onStateChangeCallback = onStateChange;
  }

  startListening(): boolean {
    if (!this.recognition) {
      if (this.onErrorCallback) {
        this.onErrorCallback('Speech recognition is not supported in this browser. Please use Google Chrome, Edge, or an Android browser.');
      }
      return false;
    }

    if (this.isListening) {
      this.stopListening();
      return false;
    }

    try {
      this.recognition.start();
      this.isListening = true;
      if (this.onStateChangeCallback) this.onStateChangeCallback(true);
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to start microphone';
      if (this.onErrorCallback) this.onErrorCallback(msg);
      this.isListening = false;
      if (this.onStateChangeCallback) this.onStateChangeCallback(false);
      return false;
    }
  }

  stopListening() {
    if (this.recognition && this.isListening) {
      try {
        this.recognition.stop();
      } catch {}
      this.isListening = false;
      if (this.onStateChangeCallback) this.onStateChangeCallback(false);
    }
  }

  speak(text: string): boolean {
    if (!isSpeechSynthesisSupported()) return false;
    try {
      window.speechSynthesis.cancel(); // Cancel any ongoing speech
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.pitch = 0.95; // Robotic timbre
      utterance.rate = 1.05;
      
      // Select robotic voice if available
      const voices = window.speechSynthesis.getVoices();
      const engVoice = voices.find(v => v.lang.startsWith('en') && (v.name.includes('Google') || v.name.includes('David') || v.name.includes('Zira')));
      if (engVoice) utterance.voice = engVoice;

      window.speechSynthesis.speak(utterance);
      return true;
    } catch {
      return false;
    }
  }
}
