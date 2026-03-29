import type {
  AppSettings,
  ProviderMessage,
  ProviderProfile,
  ProviderStreamChunk,
  ProviderType,
  ToolCall,
  ToolDefinition,
} from "../types.js";
import { ollamaProvider } from "./ollama.js";
import { openAiCompatibleProvider } from "./openai-compatible.js";

export interface StreamChatInput {
  profile: ProviderProfile;
  model: string;
  messages: ProviderMessage[];
  think?: boolean | "low" | "medium" | "high";
  maxTokens?: number;
  tools?: ToolDefinition[];
}

export interface CompleteChatResult {
  content: string;
  toolCalls: ToolCall[];
}

export interface ProviderAdapter {
  listModels(profile: ProviderProfile): Promise<string[]>;
  streamChat(input: StreamChatInput): AsyncGenerator<ProviderStreamChunk>;
  completeChat(input: StreamChatInput): Promise<CompleteChatResult>;
}

const adapters: Record<ProviderType, ProviderAdapter> = {
  openai: openAiCompatibleProvider,
  vllm: openAiCompatibleProvider,
  ollama: ollamaProvider,
};

export function getProviderAdapter(type: ProviderType): ProviderAdapter {
  return adapters[type];
}

export function getProfile(settings: AppSettings, profileId?: string): ProviderProfile {
  const resolvedId = profileId ?? settings.activeProfileId;
  const profile = settings.profiles.find((entry) => entry.id === resolvedId);

  if (!profile) {
    throw new Error(`Provider profile not found: ${resolvedId}`);
  }

  return profile;
}
