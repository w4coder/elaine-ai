import { ArrowLeft, Check, Eye, EyeOff, Plus, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import type { AppSettings, ProviderProfile, ProviderType, UserModel } from "../lib/types";

const MASKED = "__masked__";

const PROVIDER_DEFAULTS: Record<
  ProviderType,
  { label: string; url: string; placeholder: string; needsKey: boolean }
> = {
  ollama: {
    label: "Ollama",
    url: "http://127.0.0.1:11434",
    placeholder: "llama3.2",
    needsKey: false,
  },
  openai: {
    label: "OpenAI Compatible",
    url: "https://api.openai.com/v1",
    placeholder: "gpt-4o",
    needsKey: true,
  },
  vllm: {
    label: "vLLM",
    url: "http://127.0.0.1:8000",
    placeholder: "meta-llama/Llama-3-8b-instruct",
    needsKey: false,
  },
};

const inputClass = "w-full px-3 py-2.5 text-sm rounded-xl outline-none transition-colors";
const inputStyle = {
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.1)",
  color: "rgba(255,255,255,0.85)",
};

interface FormState {
  providerType: ProviderType;
  name: string;
  modelId: string;
  url: string;
  apiKey: string;
}

const blankForm = (type: ProviderType = "ollama"): FormState => ({
  providerType: type,
  name: PROVIDER_DEFAULTS[type].label,
  modelId: "",
  url: PROVIDER_DEFAULTS[type].url,
  apiKey: "",
});

function toMaskedSettings(settings: AppSettings): AppSettings {
  return {
    ...settings,
    profiles: settings.profiles.map((profile) => ({
      ...profile,
      apiKey: profile.apiKey ? MASKED : profile.apiKey,
    })),
  };
}

function buildProfileDraft(
  existing: ProviderProfile | undefined,
  form: FormState
): ProviderProfile {
  return {
    id: existing?.id ?? `${form.providerType}-${Date.now()}`,
    name: form.name.trim(),
    providerType: form.providerType,
    baseUrl: form.url.trim(),
    apiKey: form.apiKey.trim() || existing?.apiKey || "",
    enabled: true,
  };
}

export function ModelsPage() {
  const navigate = useNavigate();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [userModels, setUserModels] = useState<UserModel[]>([]);
  const [pageError, setPageError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(blankForm("ollama"));
  const [showKey, setShowKey] = useState(false);
  const [validating, setValidating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState(false);
  const [availableSuggestions, setAvailableSuggestions] = useState<string[]>([]);

  useEffect(() => {
    void Promise.all([api.getSettings(), api.listUserModels()])
      .then(([nextSettings, nextUserModels]) => {
        setSettings(nextSettings);
        setUserModels(nextUserModels);
      })
      .catch((error: unknown) => {
        setPageError(error instanceof Error ? error.message : "Failed to load models.");
      });
  }, []);

  const groupedModels = useMemo(() => {
    if (!settings) return [];
    return settings.profiles
      .map((profile) => ({
        profile,
        models: userModels.filter((entry) => entry.profileId === profile.id),
      }))
      .filter((group) => group.models.length > 0);
  }, [settings, userModels]);

  function setProviderType(type: ProviderType) {
    const defaults = PROVIDER_DEFAULTS[type];
    setForm((current) => ({
      ...current,
      providerType: type,
      url: defaults.url,
      name: defaults.label,
    }));
    setFormError(null);
  }

  function patchForm(patch: Partial<FormState>) {
    setForm((current) => ({ ...current, ...patch }));
    setFormError(null);
  }

  async function handleAddModel() {
    if (!settings) return;

    const { providerType, name, modelId, url, apiKey } = form;
    if (!modelId.trim() || !url.trim() || !name.trim()) {
      setFormError("Provider name, URL, and Model ID are required.");
      return;
    }

    setValidating(true);
    setFormError(null);
    setAvailableSuggestions([]);

    try {
      const validation = await api.validateProvider({
        providerType,
        baseUrl: url.trim(),
        apiKey: apiKey.trim() || undefined,
        model: modelId.trim(),
      });

      if (!validation.supported) {
        setFormError(validation.error ?? `Model "${modelId}" not found on this provider.`);
        setAvailableSuggestions(validation.availableModels ?? []);
        return;
      }

      const existingProfile = settings.profiles.find(
        (profile) =>
          profile.providerType === providerType &&
          profile.baseUrl === url.trim() &&
          profile.name === name.trim()
      );
      const profileDraft = buildProfileDraft(existingProfile, form);
      const nextSettings: AppSettings = {
        ...toMaskedSettings(settings),
        activeProfileId: profileDraft.id,
        profiles: existingProfile
          ? settings.profiles.map((profile) =>
              profile.id === existingProfile.id
                ? profileDraft
                : { ...profile, apiKey: profile.apiKey ? MASKED : profile.apiKey }
            )
          : [...toMaskedSettings(settings).profiles, profileDraft],
      };

      const savedSettings = await api.saveSettings(nextSettings);
      const createdModel = await api.createUserModel({
        profileId: profileDraft.id,
        model: modelId.trim(),
      });

      setSettings(savedSettings);
      setUserModels((current) => {
        if (current.some((entry) => entry.id === createdModel.id)) {
          return current;
        }
        return [...current, createdModel];
      });
      setForm(blankForm(providerType));
      setFormSuccess(true);
      setTimeout(() => setFormSuccess(false), 2500);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Failed to save model.");
    } finally {
      setValidating(false);
    }
  }

  async function handleRemoveModel(model: UserModel) {
    try {
      await api.deleteUserModel(model.id);
      setUserModels((current) => current.filter((entry) => entry.id !== model.id));
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Failed to delete model.");
    }
  }

  if (!settings) {
    return (
      <div
        className="flex items-center justify-center h-screen text-sm"
        style={{ background: "#1a1915", color: "rgba(255,255,255,0.4)" }}
      >
        {pageError ?? "Loading..."}
      </div>
    );
  }

  const defaults = PROVIDER_DEFAULTS[form.providerType];

  return (
    <div className="min-h-screen" style={{ background: "#1a1915", color: "rgba(255,255,255,0.9)" }}>
      <div
        className="flex items-center gap-3 px-6 py-4"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}
      >
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-sm"
          style={{ color: "rgba(255,255,255,0.45)" }}
          onMouseEnter={(event) => (event.currentTarget.style.color = "rgba(255,255,255,0.85)")}
          onMouseLeave={(event) => (event.currentTarget.style.color = "rgba(255,255,255,0.45)")}
        >
          <ArrowLeft size={16} />
          Back
        </button>
        <span className="text-sm font-semibold ml-2">Models</span>
      </div>

      {pageError && (
        <div
          className="mx-6 mt-4 px-4 py-3 rounded-xl text-sm flex items-center gap-2"
          style={{ background: "rgba(248,113,113,0.08)", color: "#f87171" }}
        >
          <span className="flex-1">{pageError}</span>
          <button type="button" onClick={() => setPageError(null)}>
            <X size={13} />
          </button>
        </div>
      )}

      <div className="max-w-2xl mx-auto px-6 py-8 space-y-10">
        <section>
          <h2 className="text-sm font-semibold mb-5">Add a model</h2>

          <div className="flex gap-2 mb-5">
            {(["ollama", "openai", "vllm"] as ProviderType[]).map((type) => {
              const active = form.providerType === type;
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => setProviderType(type)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium"
                  style={{
                    background: active ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.04)",
                    border: `1px solid ${active ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.07)"}`,
                    color: active ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.4)",
                  }}
                >
                  {PROVIDER_DEFAULTS[type].label}
                </button>
              );
            })}
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-xs mb-1.5" style={{ color: "rgba(255,255,255,0.4)" }}>
                Provider name
              </label>
              <input
                type="text"
                value={form.name}
                onChange={(event) => patchForm({ name: event.target.value })}
                className={inputClass}
                style={inputStyle}
                placeholder={defaults.label}
              />
            </div>

            <div>
              <label className="block text-xs mb-1.5" style={{ color: "rgba(255,255,255,0.4)" }}>
                Model ID
              </label>
              <input
                type="text"
                value={form.modelId}
                onChange={(event) => patchForm({ modelId: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void handleAddModel();
                }}
                className={inputClass}
                style={inputStyle}
                placeholder={defaults.placeholder}
              />
            </div>

            <div>
              <label className="block text-xs mb-1.5" style={{ color: "rgba(255,255,255,0.4)" }}>
                {form.providerType === "openai" ? "Base URL" : "Server URL"}
              </label>
              <input
                type="url"
                value={form.url}
                onChange={(event) => patchForm({ url: event.target.value })}
                className={inputClass}
                style={inputStyle}
                placeholder={defaults.url}
              />
            </div>

            {defaults.needsKey && (
              <div>
                <label className="block text-xs mb-1.5" style={{ color: "rgba(255,255,255,0.4)" }}>
                  API Key <span style={{ color: "rgba(255,255,255,0.22)" }}>encrypted at rest</span>
                </label>
                <div className="relative">
                  <input
                    type={showKey ? "text" : "password"}
                    value={form.apiKey}
                    onChange={(event) => patchForm({ apiKey: event.target.value })}
                    className={`${inputClass} pr-10`}
                    style={inputStyle}
                    placeholder="sk-..."
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    className="absolute right-3 top-1/2 -translate-y-1/2"
                    style={{ color: "rgba(255,255,255,0.3)" }}
                    onClick={() => setShowKey((current) => !current)}
                  >
                    {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
            )}
          </div>

          {formError && (
            <div className="mt-3">
              <p className="text-xs" style={{ color: "#f87171" }}>
                {formError}
              </p>
              {availableSuggestions.length > 0 && (
                <div className="mt-2">
                  <p className="text-xs mb-1.5" style={{ color: "rgba(255,255,255,0.35)" }}>
                    Models found on this provider - click to use:
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {availableSuggestions.map((entry) => (
                      <button
                        key={entry}
                        type="button"
                        onClick={() => {
                          patchForm({ modelId: entry });
                          setAvailableSuggestions([]);
                        }}
                        className="px-2.5 py-1 rounded-lg text-xs"
                        style={{
                          background: "rgba(255,255,255,0.07)",
                          border: "1px solid rgba(255,255,255,0.1)",
                          color: "rgba(255,255,255,0.75)",
                        }}
                      >
                        {entry}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => void handleAddModel()}
            disabled={validating || !form.modelId.trim() || !form.url.trim() || !form.name.trim()}
            className="mt-4 flex items-center gap-2 px-4 py-2.5 text-sm rounded-xl font-medium disabled:opacity-40"
            style={{
              background: "rgba(255,255,255,0.09)",
              color: "rgba(255,255,255,0.9)",
              border: "1px solid rgba(255,255,255,0.11)",
            }}
          >
            {validating ? (
              <div
                className="w-4 h-4 rounded-full"
                style={{
                  border: "2px solid rgba(255,255,255,0.2)",
                  borderTopColor: "rgba(255,255,255,0.8)",
                  animation: "spin 0.7s linear infinite",
                }}
              />
            ) : formSuccess ? (
              <Check size={14} />
            ) : (
              <Plus size={14} />
            )}
            {validating ? "Validating..." : formSuccess ? "Added!" : "Validate & add"}
          </button>
        </section>

        <section>
          <h2 className="text-sm font-semibold mb-4">Your providers</h2>
          {groupedModels.length === 0 ? (
            <p className="text-sm" style={{ color: "rgba(255,255,255,0.35)" }}>
              No saved models yet.
            </p>
          ) : (
            <div className="space-y-3">
              {groupedModels.map(({ profile, models }) => (
                <div
                  key={profile.id}
                  className="rounded-xl overflow-hidden"
                  style={{ border: "1px solid rgba(255,255,255,0.08)" }}
                >
                  <div
                    className="px-4 py-3"
                    style={{
                      background: "rgba(255,255,255,0.03)",
                      borderBottom: "1px solid rgba(255,255,255,0.06)",
                    }}
                  >
                    <p className="text-sm font-medium">{profile.name}</p>
                    <p
                      className="text-xs mt-0.5 space-x-1"
                      style={{ color: "rgba(255,255,255,0.35)" }}
                    >
                      <span>
                        {PROVIDER_DEFAULTS[profile.providerType]?.label ?? profile.providerType}
                      </span>
                      <span>-</span>
                      <span>{profile.baseUrl}</span>
                      {profile.apiKey === MASKED && (
                        <>
                          <span>-</span>
                          <span>API key stored</span>
                        </>
                      )}
                    </p>
                  </div>

                  {models.map((entry, index) => (
                    <div
                      key={entry.id}
                      className="flex items-center justify-between px-4 py-2.5 group"
                      style={{
                        borderTop: index === 0 ? "none" : "1px solid rgba(255,255,255,0.05)",
                      }}
                    >
                      <span className="text-sm" style={{ color: "rgba(255,255,255,0.75)" }}>
                        {entry.model}
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleRemoveModel(entry)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                        style={{ color: "rgba(248,113,113,0.65)" }}
                        title="Remove model"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
