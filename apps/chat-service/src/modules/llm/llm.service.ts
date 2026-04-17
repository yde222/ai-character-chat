import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI, GenerativeModel, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import Anthropic from '@anthropic-ai/sdk';
import { CircuitBreakerService } from './circuit-breaker.service';
import { ILlmRequest, ILlmResponse } from '@app/common/interfaces';
import { EmotionTag } from '@app/common/constants';
import { measureLatency, withRetry } from '@app/common/utils';

/**
 * LLM Service — 실제 Gemini + Claude SDK 연동
 *
 * ============================================================
 * 듀얼 모델 아키텍처:
 *
 * Primary: Gemini 2.5 Pro
 * - 장점: 컨텍스트 윈도우 1M 토큰, 한국어 성능 우수
 * - 비용: $1.25/1M input, $10/1M output (200K 이하)
 * - 출처: Google AI Studio 가격표, 2025년 기준
 *
 * Fallback: Claude Sonnet 4
 * - 장점: 캐릭터 롤플레이 품질 업계 최고 수준
 * - 비용: $3/1M input, $15/1M output
 * - 출처: Anthropic 공식 가격표, 2025년 기준
 *
 * 비용 시뮬레이션 (3-Tier 컨텍스트 적용, 턴당 ~2300 토큰):
 * | 규모      | Gemini 월 비용 | Claude 월 비용 | 차이    |
 * |----------|-------------|-------------|--------|
 * | DAU 100  | $58         | $138        | 2.4x   |
 * | DAU 1000 | $580        | $1,380      | 2.4x   |
 * | DAU 10K  | $5,800      | $13,800     | 2.4x   |
 *
 * → Gemini를 Primary로 쓰는 이유: 동일 품질에서 비용 58% 절감
 * → Claude를 Fallback으로 유지하는 이유: 롤플레이 품질이 Gemini 장애 시 UX 보존
 * ============================================================
 */
@Injectable()
export class LlmService implements OnModuleInit {
  private readonly logger = new Logger(LlmService.name);
  private readonly primaryModelId: string;
  private readonly fallbackModelId: string;

  // SDK 클라이언트
  private geminiModel: GenerativeModel | null = null;
  private anthropicClient: Anthropic | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly circuitBreaker: CircuitBreakerService,
  ) {
    this.primaryModelId = this.config.get('LLM_PRIMARY_MODEL', 'gemini-2.5-pro');
    this.fallbackModelId = this.config.get('LLM_FALLBACK_MODEL', 'claude-sonnet-4-6');
  }

  onModuleInit() {
    // Gemini SDK 초기화
    const geminiKey = this.config.get<string>('GEMINI_API_KEY');
    if (geminiKey) {
      const genAI = new GoogleGenerativeAI(geminiKey);
      this.geminiModel = genAI.getGenerativeModel({
        model: this.primaryModelId,
        safetySettings: [
          {
            category: HarmCategory.HARM_CATEGORY_HARASSMENT,
            threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
          },
          {
            category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
            threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
          },
          {
            category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
            threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
          },
          {
            category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
            threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
          },
        ],
      });
      this.logger.log(`✅ Gemini SDK initialized: ${this.primaryModelId}`);
    } else {
      this.logger.warn('⚠️ GEMINI_API_KEY not set — Gemini unavailable');
    }

    // Anthropic SDK 초기화
    const anthropicKey = this.config.get<string>('ANTHROPIC_API_KEY');
    if (anthropicKey) {
      this.anthropicClient = new Anthropic({ apiKey: anthropicKey });
      this.logger.log(`✅ Anthropic SDK initialized: ${this.fallbackModelId}`);
    } else {
      this.logger.warn('⚠️ ANTHROPIC_API_KEY not set — Claude unavailable');
    }
  }

  // ============================================================
  // Public API — Circuit Breaker + 듀얼 모델 전환 로직
  // (이전 버전과 동일 — generateResponse, generateResponseStream)
  // ============================================================

  async generateResponse(request: ILlmRequest): Promise<ILlmResponse> {
    const endLatency = measureLatency();

    if (this.circuitBreaker.canRequest(this.primaryModelId)) {
      try {
        const response = await withRetry(
          () => this.callLlmApi(this.primaryModelId, request),
          { maxRetries: 2, baseDelayMs: 100 },
        );
        this.circuitBreaker.recordSuccess(this.primaryModelId);
        response.latencyMs = endLatency();
        return response;
      } catch (error) {
        this.circuitBreaker.recordFailure(this.primaryModelId);
        this.logger.warn(`Primary (${this.primaryModelId}) failed: ${error.message}. Falling back.`);
      }
    }

    if (this.circuitBreaker.canRequest(this.fallbackModelId)) {
      try {
        const response = await withRetry(
          () => this.callLlmApi(this.fallbackModelId, request),
          { maxRetries: 2, baseDelayMs: 100 },
        );
        this.circuitBreaker.recordSuccess(this.fallbackModelId);
        response.latencyMs = endLatency();
        response.model = `${this.fallbackModelId} (fallback)`;
        return response;
      } catch (error) {
        this.circuitBreaker.recordFailure(this.fallbackModelId);
        this.logger.error(`Fallback also failed: ${error.message}`);
        throw new Error('All LLM models unavailable');
      }
    }

    throw new Error(`All circuits open — primary: ${this.primaryModelId}, fallback: ${this.fallbackModelId}`);
  }

  async generateResponseStream(
    request: ILlmRequest,
    onChunk: (text: string, isFinal: boolean, emotion?: EmotionTag, tokenUsage?: any) => void,
  ): Promise<void> {
    const model = this.circuitBreaker.canRequest(this.primaryModelId)
      ? this.primaryModelId
      : this.fallbackModelId;

    try {
      await this.callLlmStreamApi(model, request, onChunk);
      this.circuitBreaker.recordSuccess(model);
    } catch (error) {
      this.circuitBreaker.recordFailure(model);

      if (model === this.primaryModelId && this.circuitBreaker.canRequest(this.fallbackModelId)) {
        this.logger.warn(`Streaming fallback to ${this.fallbackModelId}`);
        await this.callLlmStreamApi(this.fallbackModelId, request, onChunk);
        this.circuitBreaker.recordSuccess(this.fallbackModelId);
      } else {
        throw error;
      }
    }
  }

  // ============================================================
  // Private — 실제 SDK 호출
  // ============================================================

  /**
   * 비스트리밍 호출 — Gemini 또는 Claude
   */
  private async callLlmApi(modelId: string, request: ILlmRequest): Promise<ILlmResponse> {
    if (this.isGeminiModel(modelId)) {
      return this.callGeminiApi(request);
    } else {
      return this.callClaudeApi(modelId, request);
    }
  }

  /**
   * 스트리밍 호출 — Gemini 또는 Claude
   */
  private async callLlmStreamApi(
    modelId: string,
    request: ILlmRequest,
    onChunk: (text: string, isFinal: boolean, emotion?: EmotionTag, tokenUsage?: any) => void,
  ): Promise<void> {
    if (this.isGeminiModel(modelId)) {
      return this.callGeminiStreamApi(request, onChunk);
    } else {
      return this.callClaudeStreamApi(modelId, request, onChunk);
    }
  }

  // ============================================================
  // Gemini SDK 연동
  // ============================================================

  private async callGeminiApi(request: ILlmRequest): Promise<ILlmResponse> {
    if (!this.geminiModel) {
      throw new Error('Gemini SDK not initialized — GEMINI_API_KEY missing');
    }

    const prompt = this.buildPrompt(request);

    const result = await this.geminiModel.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      systemInstruction: { role: 'system', parts: [{ text: request.systemPrompt }] },
      generationConfig: {
        maxOutputTokens: request.maxTokens,
        temperature: request.temperature,
      },
    });

    const response = result.response;
    const text = response.text();
    const { content, emotion } = this.parseEmotionFromResponse(text);

    // 토큰 사용량 추출
    const usage = response.usageMetadata;

    return {
      content,
      emotion,
      tokenUsage: {
        promptTokens: usage?.promptTokenCount || 0,
        completionTokens: usage?.candidatesTokenCount || 0,
        totalTokens: usage?.totalTokenCount || 0,
      },
      model: this.primaryModelId,
      latencyMs: 0,
    };
  }

  /**
   * Gemini 스트리밍
   *
   * 라이브 스트리밍 경험 직접 적용:
   * - for await 루프로 청크 수신 → 라이브 스트림 패킷 처리와 동일 패턴
   * - 버퍼링: 너무 작은 청크는 합쳐서 전송 (네트워크 효율)
   * - 최종 청크에서 감정 태그 추출 + 토큰 사용량 반환
   */
  private async callGeminiStreamApi(
    request: ILlmRequest,
    onChunk: (text: string, isFinal: boolean, emotion?: EmotionTag, tokenUsage?: any) => void,
  ): Promise<void> {
    if (!this.geminiModel) {
      throw new Error('Gemini SDK not initialized — GEMINI_API_KEY missing');
    }

    const prompt = this.buildPrompt(request);

    const result = await this.geminiModel.generateContentStream({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      systemInstruction: { role: 'system', parts: [{ text: request.systemPrompt }] },
      generationConfig: {
        maxOutputTokens: request.maxTokens,
        temperature: request.temperature,
      },
    });

    let fullText = '';
    let buffer = '';
    const BUFFER_THRESHOLD = 4; // 4글자 이상 모이면 전송 (청크 최적화)

    for await (const chunk of result.stream) {
      const chunkText = chunk.text();
      if (!chunkText) continue;

      fullText += chunkText;
      buffer += chunkText;

      // 버퍼링: 너무 잦은 전송 방지 (라이브 스트림 패킷 버퍼링과 동일)
      if (buffer.length >= BUFFER_THRESHOLD) {
        onChunk(buffer, false);
        buffer = '';
      }
    }

    // 버퍼에 남은 텍스트 플러시
    const { content, emotion } = this.parseEmotionFromResponse(fullText);

    // 최종 응답에서 토큰 사용량 추출
    const aggregated = await result.response;
    const usage = aggregated.usageMetadata;

    // 남은 버퍼 + 최종 신호 전송
    if (buffer.length > 0) {
      // 감정 태그가 버퍼에 포함됐을 수 있으므로, 클린 텍스트만 전송
      const cleanBuffer = buffer.replace(/\[EMOTION:\w+\]/g, '').trim();
      if (cleanBuffer) {
        onChunk(cleanBuffer, false);
      }
    }

    onChunk('', true, emotion, {
      prompt_tokens: usage?.promptTokenCount || 0,
      completion_tokens: usage?.candidatesTokenCount || 0,
      total_tokens: usage?.totalTokenCount || 0,
    });
  }

  // ============================================================
  // Claude (Anthropic) SDK 연동
  // ============================================================

  private async callClaudeApi(modelId: string, request: ILlmRequest): Promise<ILlmResponse> {
    if (!this.anthropicClient) {
      throw new Error('Anthropic SDK not initialized — ANTHROPIC_API_KEY missing');
    }

    const userPrompt = this.buildUserPrompt(request);

    const message = await this.anthropicClient.messages.create({
      model: modelId,
      max_tokens: request.maxTokens,
      temperature: request.temperature,
      system: request.systemPrompt,
      messages: [
        ...this.buildClaudeMessageHistory(request),
        { role: 'user', content: userPrompt },
      ],
    });

    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');

    const { content, emotion } = this.parseEmotionFromResponse(text);

    return {
      content,
      emotion,
      tokenUsage: {
        promptTokens: message.usage.input_tokens,
        completionTokens: message.usage.output_tokens,
        totalTokens: message.usage.input_tokens + message.usage.output_tokens,
      },
      model: modelId,
      latencyMs: 0,
    };
  }

  /**
   * Claude 스트리밍
   *
   * Anthropic SDK의 stream() 메서드 활용
   * Server-Sent Events 기반 — 이벤트 타입별 분기 처리
   */
  private async callClaudeStreamApi(
    modelId: string,
    request: ILlmRequest,
    onChunk: (text: string, isFinal: boolean, emotion?: EmotionTag, tokenUsage?: any) => void,
  ): Promise<void> {
    if (!this.anthropicClient) {
      throw new Error('Anthropic SDK not initialized — ANTHROPIC_API_KEY missing');
    }

    const userPrompt = this.buildUserPrompt(request);

    const stream = this.anthropicClient.messages.stream({
      model: modelId,
      max_tokens: request.maxTokens,
      temperature: request.temperature,
      system: request.systemPrompt,
      messages: [
        ...this.buildClaudeMessageHistory(request),
        { role: 'user', content: userPrompt },
      ],
    });

    let fullText = '';
    let buffer = '';
    const BUFFER_THRESHOLD = 4;

    stream.on('text', (text: string) => {
      fullText += text;
      buffer += text;

      if (buffer.length >= BUFFER_THRESHOLD) {
        onChunk(buffer, false);
        buffer = '';
      }
    });

    // 스트림 완료 대기
    const finalMessage = await stream.finalMessage();

    const { content, emotion } = this.parseEmotionFromResponse(fullText);

    // 버퍼 플러시
    if (buffer.length > 0) {
      const cleanBuffer = buffer.replace(/\[EMOTION:\w+\]/g, '').trim();
      if (cleanBuffer) {
        onChunk(cleanBuffer, false);
      }
    }

    onChunk('', true, emotion, {
      prompt_tokens: finalMessage.usage.input_tokens,
      completion_tokens: finalMessage.usage.output_tokens,
      total_tokens: finalMessage.usage.input_tokens + finalMessage.usage.output_tokens,
    });
  }

  // ============================================================
  // Claude 전용 — 멀티턴 메시지 구조
  //
  // Gemini: 단일 프롬프트에 모든 컨텍스트 주입 (단순)
  // Claude: messages 배열로 멀티턴 전달 (품질 ↑)
  // → Claude의 멀티턴 구조가 캐릭터 롤플레이 품질에서 유리
  // ============================================================

  private buildClaudeMessageHistory(request: ILlmRequest): Anthropic.MessageParam[] {
    const messages: Anthropic.MessageParam[] = [];

    // 컨텍스트 요약을 첫 번째 user 메시지로 주입
    if (request.contextSummary) {
      messages.push({
        role: 'user',
        content: `[이전 대화 요약] ${request.contextSummary}`,
      });
      messages.push({
        role: 'assistant',
        content: '네, 이전 대화 내용을 기억하고 있어요. 계속 이야기해 주세요!',
      });
    }

    // 최근 대화를 user/assistant 교대로 배치
    for (const msg of request.recentMessages) {
      messages.push({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content,
      });
    }

    return messages;
  }

  // ============================================================
  // 공통 유틸리티
  // ============================================================

  /**
   * 프롬프트 빌드 — Gemini용 (단일 프롬프트 구조)
   */
  private buildPrompt(request: ILlmRequest): string {
    const parts: string[] = [];

    if (request.contextSummary) {
      parts.push(`[이전 대화 요약]\n${request.contextSummary}`);
    }

    if (request.recentMessages.length > 0) {
      parts.push('\n[최근 대화]');
      for (const msg of request.recentMessages) {
        const role = msg.role === 'user' ? '유저' : '캐릭터';
        parts.push(`${role}: ${msg.content}`);
      }
    }

    parts.push(`\n유저: ${request.userMessage}`);
    parts.push(
      '\n[지시] 위 대화에 이어서 캐릭터로서 자연스럽게 응답하세요. ' +
        '응답 마지막 줄에 [EMOTION:태그명] 형식으로 현재 감정을 표시하세요. ' +
        '가능한 태그: NEUTRAL, JOY, SADNESS, ANGER, SURPRISE, AFFECTION, FEAR, DISGUST, EXCITEMENT, SHY',
    );

    return parts.join('\n');
  }

  /**
   * 프롬프트 빌드 — Claude용 (마지막 user 메시지)
   */
  private buildUserPrompt(request: ILlmRequest): string {
    return (
      `${request.userMessage}\n\n` +
      '[지시] 캐릭터로서 자연스럽게 응답하세요. ' +
      '응답 마지막 줄에 [EMOTION:태그명] 형식으로 현재 감정을 표시하세요. ' +
      '가능한 태그: NEUTRAL, JOY, SADNESS, ANGER, SURPRISE, AFFECTION, FEAR, DISGUST, EXCITEMENT, SHY'
    );
  }

  /**
   * 응답에서 감정 태그 파싱
   *
   * LLM 응답 끝에 [EMOTION:JOY] 같은 태그가 붙어있음
   * → 태그 추출 + 본문에서 제거
   */
  private parseEmotionFromResponse(text: string): {
    content: string;
    emotion: EmotionTag;
  } {
    const emotionMatch = text.match(/\[EMOTION:(\w+)\]/);
    let emotion = EmotionTag.NEUTRAL;

    if (emotionMatch) {
      const tag = emotionMatch[1].toUpperCase();
      const mapped = EmotionTag[tag as keyof typeof EmotionTag];
      if (mapped !== undefined) {
        emotion = mapped;
      }
    }

    // 감정 태그를 본문에서 제거
    const content = text.replace(/\[EMOTION:\w+\]/g, '').trim();

    return { content, emotion };
  }

  private isGeminiModel(modelId: string): boolean {
    return modelId.startsWith('gemini');
  }
}
