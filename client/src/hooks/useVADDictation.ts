import { useCallback, useRef, useState } from "react";
import { api } from "../lib/api";
import type { AsrProvider } from "../lib/types";

// ─── Local SpeechRecognition types (not reliably available as globals) ────────

interface SpeechRecognitionResultLike {
  readonly [index: number]: { transcript: string };
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike> & Iterable<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionErrorEventLike {
  error: string;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

// ─── Types for the dynamically-loaded VAD bundle ─────────────────────────────

interface MicVADOptions {
  workletURL?: string;
  modelURL?: string;
  ortConfig?: (ort: { env: { wasm: { wasmPaths: string | Record<string, string> } } }) => void;
  positiveSpeechThreshold?: number;
  negativeSpeechThreshold?: number;
  minSpeechFrames?: number;
  redemptionFrames?: number;
  submitUserSpeechOnPause?: boolean;
  additionalAudioConstraints?: MediaTrackConstraints;
  onSpeechStart?: () => void;
  onSpeechEnd?: (audio: Float32Array) => void | Promise<void>;
}

interface MicVADInstance {
  start(): void;
  pause(): void;
  destroy?: () => void;
}

interface VADBundle {
  MicVAD: {
    new (options: MicVADOptions): Promise<MicVADInstance>;
    new?: never;
  } & { new (options: MicVADOptions): Promise<MicVADInstance> };
}

// ─── Script loader (idempotent) ───────────────────────────────────────────────

let vadLoadPromise: Promise<void> | null = null;

function loadVADScripts(): Promise<void> {
  if (vadLoadPromise) return vadLoadPromise;

  vadLoadPromise = new Promise((resolve, reject) => {
    // Check if already loaded
    if ((window as unknown as { vad?: VADBundle }).vad) {
      resolve();
      return;
    }

    // Load ort first, then vad bundle (vad bundle calls window.ort internally)
    const ortScript = document.createElement("script");
    ortScript.src = "/ort.wasm.min.js";
    ortScript.onload = () => {
      const vadScript = document.createElement("script");
      vadScript.src = "/vad-bundle.min.js";
      vadScript.onload = () => resolve();
      vadScript.onerror = () => reject(new Error("Failed to load VAD bundle"));
      document.head.appendChild(vadScript);
    };
    ortScript.onerror = () => reject(new Error("Failed to load ONNX Runtime"));
    document.head.appendChild(ortScript);
  });

  return vadLoadPromise;
}

function getMicVAD(): typeof import("@ricky0123/vad-web").MicVAD {
  const w = window as unknown as { vad?: { MicVAD: typeof import("@ricky0123/vad-web").MicVAD } };
  if (!w.vad?.MicVAD) throw new Error("VAD not loaded");
  return w.vad.MicVAD;
}

// ─── WAV encoder ─────────────────────────────────────────────────────────────

function encodeWav(samples: Float32Array, sampleRate = 16000): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

interface UseVADDictationOptions {
  provider: AsrProvider;
  onTranscript(text: string): void;
  onError?(error: string): void;
}

export function useVADDictation({ provider, onTranscript, onError }: UseVADDictationOptions) {
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const vadRef = useRef<MicVADInstance | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const activeRef = useRef(false);

  const handleError = useCallback(
    (msg: string) => {
      setError(msg);
      onError?.(msg);
    },
    [onError]
  );

  const startSession = useCallback(async () => {
    setError(null);

    // ── Browser Web Speech API ────────────────────────────────────────────
    if (provider === "browser") {
      const SpeechRecognitionAPI =
        (window as Window & { SpeechRecognition?: SpeechRecognitionConstructor })
          .SpeechRecognition ??
        (window as Window & { webkitSpeechRecognition?: SpeechRecognitionConstructor })
          .webkitSpeechRecognition;

      if (!SpeechRecognitionAPI) {
        handleError("Browser speech recognition not supported. Use Chrome or Edge.");
        return;
      }
      const recognition = new SpeechRecognitionAPI();
      recognition.continuous = true;
      recognition.interimResults = false;
      recognition.onresult = (event: SpeechRecognitionEventLike) => {
        const text = Array.from(event.results)
          .slice(event.resultIndex)
          .map((r: SpeechRecognitionResultLike) => r[0].transcript)
          .join(" ")
          .trim();
        if (text) onTranscript(text + " ");
      };
      recognition.onerror = (event: SpeechRecognitionErrorEventLike) =>
        handleError(`Speech error: ${event.error}`);
      recognition.onend = () => {
        if (activeRef.current) recognition.start();
      };
      recognitionRef.current = recognition;
      activeRef.current = true;
      recognition.start();
      setIsSessionActive(true);
      return;
    }

    // ── Silero VAD + transcription API ───────────────────────────────────
    try {
      await loadVADScripts();
      const MicVAD = getMicVAD();

      const vad = await MicVAD.new({
        model: "v5",
        baseAssetPath: "/",
        onnxWASMBasePath: "/",
        positiveSpeechThreshold: 0.8,
        negativeSpeechThreshold: 0.35,
        minSpeechMs: 96,
        redemptionMs: 256,
        submitUserSpeechOnPause: false,
        onSpeechStart() {
          if (activeRef.current) setIsSpeaking(true);
        },
        async onSpeechEnd(audio: Float32Array) {
          if (!activeRef.current) return;
          setIsSpeaking(false);
          setIsTranscribing(true);
          try {
            const wav = encodeWav(audio);
            const result = await api.transcribeAudio(wav);
            if (activeRef.current && result.text.trim()) {
              onTranscript(result.text.trim() + " ");
            }
          } catch (err) {
            handleError(err instanceof Error ? err.message : "Transcription failed");
          } finally {
            setIsTranscribing(false);
          }
        },
      });

      vadRef.current = vad;
      activeRef.current = true;
      vad.start();
      setIsSessionActive(true);
    } catch (err) {
      vadLoadPromise = null; // allow retry
      handleError(err instanceof Error ? err.message : "Failed to start microphone");
    }
  }, [provider, onTranscript, handleError]);

  const stopSession = useCallback(() => {
    activeRef.current = false;
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    vadRef.current?.pause();
    vadRef.current?.destroy?.();
    vadRef.current = null;
    setIsSessionActive(false);
    setIsSpeaking(false);
    setIsTranscribing(false);
  }, []);

  return { isSessionActive, isSpeaking, isTranscribing, error, startSession, stopSession };
}
