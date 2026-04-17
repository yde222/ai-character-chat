import { EmotionTag } from '../constants';

// ============================================================
// 서비스 간 공유 인터페이스
// ============================================================

export interface ICharacterPersona {
  characterId: string;
  name: string;
  systemPrompt: string;
  personality: string;
  backgroundStory: string;
  speechStyle: string;
  // 감정 표현 가중치 (캐릭터마다 다른 감정 빈도)
  emotionWeights: Partial<Record<EmotionTag, number>>;
}

export interface IChatSession {
  sessionId: string;
  userId: string;
  characterId: string;
  contextSummary: string;
  recentMessages: IChatMessage[];
  totalMessageCount: number;
  createdAt: Date;
  lastActiveAt: Date;
}

export interface IChatMessage {
  messageId: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  emotion?: EmotionTag;
  tokenCount: number;
  timestamp: Date;
}

export interface ILlmRequest {
  systemPrompt: string;
  contextSummary: string;
  recentMessages: IChatMessage[];
  userMessage: string;
  maxTokens: number;
  temperature: number;
}

export interface ILlmResponse {
  content: string;
  emotion: EmotionTag;
  tokenUsage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model: string;
  latencyMs: number;
}

export interface IAssetMatch {
  assetId: string;
  cdnUrl: string;
  assetType: 'image' | 'gif' | 'animation';
  emotion: EmotionTag;
  confidence: number;
}

// Circuit Breaker 상태
export enum CircuitState {
  CLOSED = 'CLOSED',       // 정상 — 요청 통과
  OPEN = 'OPEN',           // 차단 — fallback으로 전환
  HALF_OPEN = 'HALF_OPEN', // 복구 시도 중
}

export interface ICircuitBreakerState {
  state: CircuitState;
  failureCount: number;
  lastFailureTime: number;
  successCount: number;
}
