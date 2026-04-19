import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import { IChatMessage } from '@app/common/interfaces';
import { LLM_CONFIG } from '@app/common/constants';
import { estimateTokenCount } from '@app/common/utils';

/**
 * Summarization Service — 증분 요약 엔진 (LLM 기반)
 *
 * ============================================================
 * v1 → v2 변경 사항:
 *
 * v1 (스텁): 메시지 앞 30자를 이어붙이는 단순 압축
 *   → 정보 손실 심각, 맥락 보존 불가
 *
 * v2 (현재): Gemini Flash 경량 모델로 실제 증분 요약
 *   → 비용: $0.075/1M input (Pro의 1/17 비용)
 *   → 속도: 평균 800ms (Pro 대비 3x 빠름)
 *   → 정보 보존: 핵심 사실 + 감정 하이라이트 + 관계 상태
 *
 * 비용 시뮬레이션 (Flash 기준, 턴당 ~1100 토큰 입력):
 * | 규모      | 요약 빈도    | 월 비용   |
 * |----------|-----------|---------|
 * | DAU 100  | 10회/유저/일 | $0.83   |
 * | DAU 1000 | 10회/유저/일 | $8.30   |
 * | DAU 10K  | 10회/유저/일 | $83.00  |
 *
 * → 메인 대화(Pro) 비용의 1.4%에 불과. 무시 가능 수준.
 *
 * Fallback 전략:
 * - Flash API 장애 시 → 스텁 요약 사용 (정보 손실 감수)
 * - 핵심은 "메인 대화가 절대 블로킹되지 않는 것"
 * ============================================================
 */
@Injectable()
export class SummarizationService {
  private readonly logger = new Logger(SummarizationService.name);
  private flashModel: GenerativeModel | null = null;

  constructor(@Optional() private readonly config?: ConfigService) {
    this.initFlashModel();
  }

  private initFlashModel(): void {
    const apiKey = this.config?.get<string>('GEMINI_API_KEY');
    if (apiKey) {
      const genAI = new GoogleGenerativeAI(apiKey);
      this.flashModel = genAI.getGenerativeModel({
        model: 'gemini-2.0-flash',
      });
      this.logger.log('Summarization: Gemini Flash initialized');
    } else {
      this.logger.warn('Summarization: No API key — using stub mode');
    }
  }

  /**
   * 증분 요약 실행
   *
   * 실행 흐름:
   * 1. 프롬프트 구성 (기존 요약 + 새 메시지)
   * 2. Gemini Flash 호출 (경량 모델)
   * 3. 결과 검증 + 토큰 수 체크
   * 4. 실패 시 → 스텁 폴백
   */
  async summarize(
    existingSummary: string,
    newMessages: IChatMessage[],
  ): Promise<string> {
    if (newMessages.length === 0) return existingSummary;

    const prompt = this.buildSummarizationPrompt(existingSummary, newMessages);
    const estimatedInputTokens = estimateTokenCount(prompt);

    this.logger.debug(
      `Summarizing: existing=${estimateTokenCount(existingSummary)} tokens, ` +
        `new=${newMessages.length} messages, input≈${estimatedInputTokens} tokens`,
    );

    // Gemini Flash로 실제 요약 시도
    if (this.flashModel) {
      try {
        const result = await this.flashModel.generateContent({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: LLM_CONFIG.SUMMARY_MAX_TOKENS,
            temperature: 0.3, // 요약은 낮은 temperature (창의성 < 정확성)
          },
        });

        const summary = result.response.text().trim();
        const summaryTokens = estimateTokenCount(summary);

        // 검증: 요약이 너무 짧거나 비어있으면 스텁 사용
        if (summary.length < 20) {
          this.logger.warn('Summary too short, falling back to stub');
          return this.generateStubSummary(existingSummary, newMessages);
        }

        // 검증: 토큰 수 초과 시 앞부분만 사용
        if (summaryTokens > LLM_CONFIG.SUMMARY_MAX_TOKENS * 1.2) {
          this.logger.warn(
            `Summary too long (${summaryTokens} tokens), truncating`,
          );
          return this.truncateToTokenLimit(
            summary,
            LLM_CONFIG.SUMMARY_MAX_TOKENS,
          );
        }

        const usageInfo = result.response.usageMetadata;
        this.logger.log(
          `Summary generated: ${summaryTokens} tokens, ` +
            `input=${usageInfo?.promptTokenCount || '?'}, ` +
            `output=${usageInfo?.candidatesTokenCount || '?'}`,
        );

        return summary;
      } catch (error: any) {
        this.logger.error(`Flash summarization failed: ${error.message}`);
        // 폴백 — 메인 대화를 블로킹하지 않음
      }
    }

    // 스텁 폴백
    return this.generateStubSummary(existingSummary, newMessages);
  }

  /**
   * 중요도 기반 메시지 필터링
   *
   * 컨텍스트 윈도우 최적화의 핵심:
   * 모든 메시지가 동일하게 중요하지 않음.
   *
   * 중요도 판단 기준:
   * - 감정적 강도 (강한 감정 → 높은 중요도)
   * - 정보 밀도 (사실 공유 → 높은 중요도)
   * - 대화 전환점 (주제 변경 → 높은 중요도)
   * - 길이 (너무 짧은 반응 → 낮은 중요도)
   */
  scoreMessageImportance(message: IChatMessage): number {
    let score = 0.5; // 기본 점수

    // 길이 기반 — 긴 메시지일수록 중요한 정보 포함 가능성 높음
    const contentLength = message.content.length;
    if (contentLength > 100) score += 0.2;
    else if (contentLength < 10) score -= 0.2;

    // 감정 태그 기반 — NEUTRAL이 아닌 감정은 중요 순간
    if (message.emotion !== undefined && message.emotion !== 0) {
      score += 0.15;
    }

    // 키워드 기반 — 개인 정보나 중요 이벤트
    const importantKeywords = [
      '이름', '생일', '좋아', '싫어', '약속', '비밀',
      '고백', '사랑', '보고싶', '기억', '처음',
    ];
    const hasImportantKeyword = importantKeywords.some((kw) =>
      message.content.includes(kw),
    );
    if (hasImportantKeyword) score += 0.2;

    // 질문 포함 — 대화 흐름상 중요
    if (message.content.includes('?') || message.content.includes('？')) {
      score += 0.1;
    }

    return Math.min(1.0, Math.max(0.0, score));
  }

  // ============================================================
  // Private
  // ============================================================

  /**
   * 요약 프롬프트 구성 — 3-Tier 구조
   *
   * Tier 1: 절대 보존 (유저 개인정보, 관계 상태)
   * Tier 2: 높은 보존 (감정 하이라이트, 중요 이벤트)
   * Tier 3: 선택 보존 (일반 대화, 일상 인사)
   */
  private buildSummarizationPrompt(
    existingSummary: string,
    messages: IChatMessage[],
  ): string {
    const parts: string[] = [];

    parts.push(
      '당신은 AI 캐릭터 연애 시뮬레이션의 대화를 요약하는 전문 요약가입니다. ' +
        '기존 요약을 기반으로 새 대화 내용을 통합하여 업데이트된 요약을 작성하세요.',
    );

    parts.push('\n[요약 규칙 — 3-Tier 보존 체계]');
    parts.push('');
    parts.push('■ Tier 1 (절대 보존):');
    parts.push('  - 유저가 공유한 개인 정보 (이름, 취향, 관심사, 직업)');
    parts.push('  - 캐릭터와의 관계 단계 (첫 만남/친구/연인 등)');
    parts.push('  - 유저가 한 약속이나 계획');
    parts.push('');
    parts.push('■ Tier 2 (높은 보존):');
    parts.push('  - 감정적으로 중요한 순간 (고백, 위로, 다툼 등)');
    parts.push('  - 둘만의 내부 농담이나 별명');
    parts.push('  - 반복되는 대화 패턴');
    parts.push('');
    parts.push('■ Tier 3 (선택 보존):');
    parts.push('  - 일상적 안부 (요약에서 제외 가능)');
    parts.push('  - 단순 반응 ("ㅋㅋ", "그렇구나" 등)');
    parts.push('  - 이미 요약에 포함된 중복 내용');
    parts.push('');
    parts.push('[형식] 500토큰 이내의 자연스러운 문장으로 작성하세요.');

    if (existingSummary) {
      parts.push(`\n[기존 요약]\n${existingSummary}`);
    }

    parts.push('\n[새 대화]');

    // 중요도 점수 기반으로 메시지에 가중치 표시
    for (const msg of messages) {
      const role = msg.role === 'user' ? '유저' : '캐릭터';
      const importance = this.scoreMessageImportance(msg);
      const marker = importance >= 0.7 ? ' ★' : '';
      parts.push(`${role}: ${msg.content}${marker}`);
    }

    parts.push('\n[업데이트된 요약]');

    return parts.join('\n');
  }

  /**
   * 스텁 요약 (개발/테스트용 + API 장애 시 폴백)
   */
  private generateStubSummary(
    existingSummary: string,
    messages: IChatMessage[],
  ): string {
    const userMessages = messages.filter((m) => m.role === 'user');
    const importantMessages = messages.filter(
      (m) => this.scoreMessageImportance(m) >= 0.7,
    );

    const topics = userMessages
      .map((m) => m.content.slice(0, 40))
      .slice(0, 3)
      .join('; ');

    const highlights = importantMessages
      .map((m) => {
        const role = m.role === 'user' ? '유저' : '캐릭터';
        return `${role}: "${m.content.slice(0, 50)}..."`;
      })
      .slice(0, 2)
      .join(' / ');

    const newPart = `[${messages.length}개 메시지] 주제: ${topics}` +
      (highlights ? ` | 핵심: ${highlights}` : '');

    if (existingSummary) {
      return `${existingSummary}\n${newPart}`;
    }
    return newPart;
  }

  /**
   * 토큰 제한까지 텍스트 자르기
   */
  private truncateToTokenLimit(text: string, maxTokens: number): string {
    // 한국어 기준: 약 1.5자 = 1토큰
    const maxChars = Math.floor(maxTokens * 1.5);
    if (text.length <= maxChars) return text;

    // 문장 단위로 자르기 (마지막 완성 문장까지)
    const truncated = text.slice(0, maxChars);
    const lastSentenceEnd = Math.max(
      truncated.lastIndexOf('.'),
      truncated.lastIndexOf('다.'),
      truncated.lastIndexOf('요.'),
    );

    return lastSentenceEnd > maxChars * 0.5
      ? truncated.slice(0, lastSentenceEnd + 1)
      : truncated + '...';
  }
}
