import {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  ImagePlus,
  Loader2,
  Mic,
  Square,
  X,
} from "lucide-react";
import { useRef, useState, type ChangeEvent } from "react";
import type { AppSettings, ImageAttachment, ProviderProfile, UserModel } from "../lib/types";
import { useVADDictation } from "../hooks/useVADDictation";
import { ASRSetupModal } from "./ASRSetupModal";

interface ChatComposerProps {
  value: string;
  disabled: boolean;
  isGenerating: boolean;
  supportsImageUpload: boolean;
  model: string;
  profileId: string;
  models: UserModel[];
  profiles: ProviderProfile[];
  images: ImageAttachment[];
  settings: AppSettings | null;
  onChange(value: string): void;
  onSubmit(): void;
  onAddImages(images: ImageAttachment[]): void;
  onRemoveImage(index: number): void;
  onSelectModel(model: UserModel): void;
  onManageModels(): void;
  onSaveSettings(
    updates: Pick<AppSettings, "asrProvider" | "asrBaseUrl" | "asrApiKey" | "asrModel">
  ): void;
}

function readImageFile(file: File): Promise<ImageAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.onload = () =>
      resolve({
        name: file.name,
        mimeType: file.type || "image/png",
        dataUrl: String(reader.result ?? ""),
      });
    reader.readAsDataURL(file);
  });
}

export function ChatComposer(props: ChatComposerProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [showAsrSetup, setShowAsrSetup] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const hasAsrConfigured = !!props.settings?.asrProvider;

  const { isSessionActive, isSpeaking, isTranscribing, startSession, stopSession } =
    useVADDictation({
      provider: props.settings?.asrProvider ?? "browser",
      onTranscript: (text) => props.onChange(props.value + text),
    });

  const selectedModel =
    props.models.find(
      (entry) => entry.profileId === props.profileId && entry.model === props.model
    ) ?? null;
  const triggerLabel =
    selectedModel?.model || (props.models.length > 0 ? "Select model" : "Add model");

  function openPicker() {
    if (props.models.length === 0) {
      props.onManageModels();
      return;
    }
    setPickerOpen(true);
  }

  function closePicker() {
    setPickerOpen(false);
  }

  async function handleFilesSelected(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []).filter((file) =>
      file.type.startsWith("image/")
    );
    event.target.value = "";
    if (!files.length) return;
    const images = await Promise.all(files.map(readImageFile));
    props.onAddImages(images);
  }

  function handleMicClick() {
    if (!hasAsrConfigured) {
      setShowAsrSetup(true);
      return;
    }
    if (isSessionActive) {
      stopSession();
    } else {
      void startSession();
    }
  }

  // Mic button visual state
  const micRingClass = isSessionActive
    ? isSpeaking
      ? "ring-2 ring-red-500 animate-pulse"
      : "ring-2 ring-red-500/40"
    : "";

  return (
    <div className="composer rounded-3xl" style={{ position: "relative" }}>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(event) => void handleFilesSelected(event)}
      />

      {props.images.length > 0 && (
        <div className="composer__attachments">
          {props.images.map((image, index) => (
            <div key={`${image.name}-${index}`} className="composer__attachment">
              <img className="composer__attachment-preview" src={image.dataUrl} alt={image.name} />
              <div className="composer__attachment-meta">
                <span className="composer__attachment-name">{image.name}</span>
              </div>
              <button
                className="composer__attachment-remove"
                type="button"
                onClick={() => props.onRemoveImage(index)}
                aria-label={`Remove ${image.name}`}
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      <textarea
        value={props.value}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            props.onSubmit();
          }
        }}
        placeholder="How can I help you?"
        className="text-m"
      />

      <div className="composer__footer flex items-end">
        <div className="composer__footer-start flex items-end">
          {props.supportsImageUpload && (
            <button
              className="composer__utility-button"
              type="button"
              disabled={props.disabled}
              onClick={() => fileInputRef.current?.click()}
              title="Upload images for Ollama"
              aria-label="Upload images"
            >
              <ImagePlus size={14} />
              <span>Image</span>
            </button>
          )}
          <button className="model-picker-trigger" type="button" onClick={openPicker}>
            <span className="truncated ellipsis text-sm">{triggerLabel}</span>
            <ChevronDown size={13} />
          </button>
        </div>

        <div className="flex items-center gap-3">
          {/* Mic button */}
          <button
            className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all disabled:cursor-not-allowed disabled:opacity-50 bg-transparent hover:bg-border ${micRingClass}`}
            type="button"
            onClick={handleMicClick}
            disabled={props.disabled}
            aria-label={isSessionActive ? "Stop dictation" : "Start dictation"}
            title={
              !hasAsrConfigured
                ? "Set up voice input"
                : isSessionActive
                  ? "Stop dictation"
                  : "Dictate message"
            }
          >
            {isTranscribing ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Mic size={18} className={isSessionActive ? "text-red-400" : ""} />
            )}
          </button>

          {/* Send button / generating indicator */}
          {props.isGenerating ? (
            <button
              className="send-button send-button--generating"
              type="button"
              disabled
              aria-label="Generating…"
              title="Generating…"
            >
              <Square size={13} fill="currentColor" />
            </button>
          ) : (
            <button
              className="send-button"
              type="button"
              onClick={props.onSubmit}
              disabled={
                props.disabled || (!props.value.trim() && props.images.length === 0) || !props.model
              }
              aria-label="Send message"
            >
              <ArrowUp size={18} />
            </button>
          )}
        </div>
      </div>

      {/* Model picker dropdown */}
      {pickerOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={closePicker} />
          <div
            className="absolute bottom-[calc(100%+8px)] left-0 z-50 w-72 rounded-2xl overflow-hidden shadow-2xl"
            style={{ background: "#2a2825", border: "1px solid rgba(255,255,255,0.1)" }}
            onClick={(event) => event.stopPropagation()}
          >
            <div
              className="flex items-center justify-between px-4 py-3"
              style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}
            >
              <span className="text-sm font-medium" style={{ color: "rgba(255,255,255,0.5)" }}>
                Models
              </span>
              <button
                type="button"
                onClick={closePicker}
                className="transition-colors"
                style={{ color: "rgba(255,255,255,0.35)" }}
                onMouseEnter={(event) =>
                  (event.currentTarget.style.color = "rgba(255,255,255,0.7)")
                }
                onMouseLeave={(event) =>
                  (event.currentTarget.style.color = "rgba(255,255,255,0.35)")
                }
              >
                <X size={15} />
              </button>
            </div>

            <div className="overflow-y-auto py-1" style={{ maxHeight: "280px" }}>
              {props.models.length === 0 ? (
                <p className="px-4 py-3 text-sm" style={{ color: "rgba(255,255,255,0.35)" }}>
                  No saved models yet.
                </p>
              ) : (
                props.models.map((entry) => {
                  const isActive =
                    entry.profileId === props.profileId && entry.model === props.model;
                  const entryProfile = props.profiles.find((p) => p.id === entry.profileId);
                  const caps = entryProfile?.modelCapabilities?.[entry.model] ?? ["text"];
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors"
                      style={{ background: "transparent" }}
                      onMouseEnter={(event) =>
                        (event.currentTarget.style.background = "rgba(255,255,255,0.05)")
                      }
                      onMouseLeave={(event) =>
                        (event.currentTarget.style.background = "transparent")
                      }
                      onClick={() => {
                        props.onSelectModel(entry);
                        closePicker();
                      }}
                    >
                      <div className="flex-1 min-w-0">
                        <p
                          className="text-sm truncate"
                          style={{
                            fontWeight: isActive ? 600 : 400,
                            color: isActive ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.75)",
                          }}
                        >
                          {entry.model}
                        </p>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {caps.map((cap) => (
                            <span
                              key={cap}
                              className="px-1.5 py-px rounded text-xs"
                              style={{
                                background:
                                  cap === "image"
                                    ? "rgba(99,179,237,0.1)"
                                    : "rgba(255,255,255,0.05)",
                                color:
                                  cap === "image"
                                    ? "rgba(147,197,253,0.7)"
                                    : "rgba(255,255,255,0.3)",
                                border: `1px solid ${cap === "image" ? "rgba(147,197,253,0.15)" : "rgba(255,255,255,0.07)"}`,
                              }}
                            >
                              {cap.charAt(0).toUpperCase() + cap.slice(1)}
                            </span>
                          ))}
                        </div>
                      </div>
                      {isActive ? (
                        <Check
                          size={15}
                          style={{ color: "rgba(255,255,255,0.9)", flexShrink: 0 }}
                        />
                      ) : null}
                    </button>
                  );
                })
              )}
            </div>

            <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
              <button
                type="button"
                className="w-full flex items-center justify-between px-4 py-3 text-sm transition-colors"
                style={{ color: "rgba(255,255,255,0.4)" }}
                onMouseEnter={(event) => {
                  event.currentTarget.style.color = "rgba(255,255,255,0.8)";
                  event.currentTarget.style.background = "rgba(255,255,255,0.04)";
                }}
                onMouseLeave={(event) => {
                  event.currentTarget.style.color = "rgba(255,255,255,0.4)";
                  event.currentTarget.style.background = "transparent";
                }}
                onClick={() => {
                  closePicker();
                  props.onManageModels();
                }}
              >
                <span>Manage models</span>
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </>
      )}

      {/* ASR setup modal */}
      {showAsrSetup && (
        <ASRSetupModal
          settings={props.settings}
          onDone={(updates) => {
            props.onSaveSettings(updates);
            setShowAsrSetup(false);
            // Start session after a tick so settings propagate
            setTimeout(() => void startSession(), 50);
          }}
          onClose={() => setShowAsrSetup(false)}
        />
      )}
    </div>
  );
}
