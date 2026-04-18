import { Injectable, Logger, Optional } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { LlmService } from '../llm/llm.service';
import { ContextManagerService } from '../context/context-manager.service';
import { AffinityService } from '../affinity/affinity.service';
import { StoryChoiceService } from '../story-choice/story-choice.service';
import { EmotionTag, LLM_CONFIG } from '@app/common/constants';
import { measureLatency } from '@app/common/utils';

/**
 * Chat Service — 핵심 비즈니스 로직
 *
 * 책임:
 * 1. 메시지 수신 → 컨텍스트 조립 → LLM 호출 → 응답 반환
 * 2. 감정 태그 추출 (LLM 응답에서 파싱)
 * 3. 대화 히스토리 관리
 *
 * 베이비챗 "감자 현상" 방어 전략:
 * - 컨텍스트 매니저가 요약 압축을 담당
 * - 최근 5턴 원문 + 이전 대화 요약으로 토큰 비용 절감
 * - 비용과 품질의 균형점을 수치로 관리
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly llmService: LlmService,
    private readonly contextManager: ContextManagerService,
    @Optional() private readonly affinityService?: AffinityService,
    @Optional() private readonly storyChoiceService?: StoryChoiceService,
  ) {}

  /**
   * 단일 응답 (비스트리밍)
   */
  async sendMessage(data: {
    session_id: string;
    user_id: string;
    message: string;
    client_timestamp: number;
  }) {
    const endLatency = measureLatency();

    // 1. 컨텍스트 조립
    const context = await this.contextManager.assembleContext(
      data.session_id,
      data.user_id,
    );

    // 2. LLM 호출
    const llmResponse = await this.llmService.generateResponse({
      systemPrompt: context.systemPrompt,
      contextSummary: context.summary,
      recentMessages: context.recentMessages,
      userMessage: data.message,
      maxTokens: LLM_CONFIG.MAX_RESPONSE_TOKENS,
      temperature: LLM_CONFIG.TEMPERATURE,
    });

    // 3. 대화 기록 저장 + 컨텍스트 업데이트
    await this.contextManager.appendMessages(data.session_id, [
      {
        messageId: uuidv4(),
        sessionId: data.session_id,
        role: 'user',
        content: data.message,
        tokenCount: llmResponse.tokenUsage.promptTokens,
        timestamp: new Date(data.client_timestamp),
      },
      {
        messageId: uuidv4(),
        sessionId: data.session_id,
        role: 'assistant',
        content: llmResponse.content,
        emotion: llmResponse.emotion,
        tokenCount: llmResponse.tokenUsage.completionTokens,
        timestamp: new Date(),
      },
    ]);

    const latencyMs = endLatency();
    this.logger.log(
      `Response generated: ${latencyMs.toFixed(0)}ms, tokens=${llmResponse.tokenUsage.totalTokens}, emotion=${EmotionTag[llmResponse.emotion]}`,
    );

    // 4. 호감도 업데이트
    let affinityResult = null;
    if (this.affinityService && (data as any).character_id) {
      try {
        affinityResult = await this.affinityService.updateByEmotion(
          data.user_id,
          (data as any).character_id,
          EmotionTag[llmResponse.emotion] || 'NEUTRAL',
        );
      } catch (err: any) {
        this.logger.warn(`Affinity update failed: ${err.message}`);
      }
    }

    return {
      message_id: uuidv4(),
      content: llmResponse.content,
      emotion: llmResponse.emotion,
      server_timestamp: Date.now(),
      token_usage: {
        prompt_tokens: llmResponse.tokenUsage.promptTokens,
        completion_tokens: llmResponse.tokenUsage.completionTokens,
        total_tokens: llmResponse.tokenUsage.totalTokens,
      },
      affinity: affinityResult,
    };
  }

  /**
   * 스트리밍 응답
   *
   * 핵심 — LLM 스트리밍 출력을 청크 단위로 콜백 전달
   * 라이브 스트리밍의 패킷 처리 경험이 여기 직접 적용됨:
   * - 청크 사이즈 최적화 (너무 작으면 오버헤드, 너무 크면 지연)
   * - 버퍼링으로 네트워크 지터 대응
   */
  async sendMessageStream(
    data: {
      session_id: string;
      user_id: string;
      message: string;
      client_timestamp: number;
    },
    onChunk: (chunk: any) => void,
  ): Promise<void> {
    const context = await this.contextManager.assembleContext(
      data.session_id,
      data.user_id,
    );

    let fullContent = '';
    let chunkIndex = 0;

    await this.llmService.generateResponseStream(
      {
        systemPrompt: context.systemPrompt,
        contextSummary: context.summary,
        recentMessages: context.recentMessages,
        userMessage: data.message,
        maxTokens: LLM_CONFIG.MAX_RESPONSE_TOKENS,
        temperature: LLM_CONFIG.TEMPERATURE,
      },
      (text: string, isFinal: boolean, emotion?: EmotionTag, tokenUsage?: any) => {
        fullContent += text;
        onChunk({
          chunk_id: `${data.session_id}_${chunkIndex++}`,
          content: text,
          is_final: isFinal,
          emotion: isFinal ? emotion : undefined,
          token_usage: isFinal ? tokenUsage : undefined,
        });
      },
    );

    // 스트리밍 완료 후 컨텍스트 업데이트 (비동기 — 응답 지연에 영향 없음)
    this.contextManager.appendMessages(data.session_id, [
      {
        messageId: uuidv4(),
        sessionId: data.session_id,
        role: 'user',
        content: data.message,
        tokenCount: 0,
        timestamp: new Date(data.client_timestamp),
      },
      {
        messageId: uuidv4(),
        sessionId: data.session_id,
        role: 'assistant',
        content: fullContent,
        emotion: EmotionTag.NEUTRAL,
        tokenCount: 0,
        timestamp: new Date(),
      },
    ]).catch((err) => {
      this.logger.error(`Context update failed: ${err.message}`);
    });

    // 호감도 업데이트 (스트리밍 완료 후, 비동기)
    if (this.affinityService && (data as any).character_id) {
      this.affinityService.updateByEmotion(
        data.user_id,
        (data as any).character_id,
        'NEUTRAL',
      ).then((result) => {
        onChunk({
          chunk_id: `${data.session_id}_affinity`,
          content: '',
          is_final: false,
          affinity: result,
          type: 'affinity_update',
        });
      }).catch((err: any) => {
        this.logger.warn(`Affinity update failed: ${err.message}`);
      });
    }
  }

  async getHistory(data: { session_id: string; user_id: string; limit: number; cursor: string }) {
    return this.contextManager.getHistory(data.session_id, data.limit, data.cursor);
  }

  async createSession(data: { user_id: string; character_id: string }) {
    const sessionId = uuidv4();
    await this.contextManager.createSession(sessionId, data.user_id, data.character_id);

    return {
      session_id: sessionId,
      character_id: data.character_id,
      context_summary: '',
      created_at: Date.now(),
    };
  }
}
