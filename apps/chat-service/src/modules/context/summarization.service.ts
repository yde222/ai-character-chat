import { Injectable, Logger } from '@nestjs/common';
import { IChatMessage } from '@app/common/interfaces';
import { LLM_CONFIG } from '@app/common/constants';
import { estimateTokenCount } from '@app/common/utils';

/**
 * Summarization Service — 증분 요약 엔진
 *
 * ============================================================
 * 왜 "증분 요약"인가?
 *
 * 방법 A — 전체 재요약:
 * 100턴 대화 전체를 매번 요약 → 토큰 비용 비례 증가
 * 1000턴이면 요약에만 $0.07/회 → 메시지당 요약 비용이 응답 비용과 맞먹음
 *
 * 방법 B — 증분 요약 (이 방식):
 * "기존 요약 500토큰 + 새 10턴 ~600토큰" → ~1100토큰 입력
 * 출력: 업데이트된 요약 500토큰
 * 비용: $0.0015/회 (고정) — 대화 길이와 무관
 *
 * 성능 비교 (1000턴 대화 기준):
 * | 전략      | 요약 비용/회 | 100회 누적 | 정보 손실  |
 * |----------|-----------|----------|---------|
 * | 전체 재요약 | $0.07     | $7.00    | 낮음     |
 * | 증분 요약  | $0.0015   | $0.15    | 약간 있음  |
 * | 절감율    |           | -97.8%   |         |
 *
 * 정보 손실 완화:
 * - 감정적 하이라이트 보존 (유저가 감정적으로 반응한 순간)
 * - 핵심 사실 보존 (유저 이름, 취향, 약속 등)
 * - 캐릭터 관계 상태 보존 (친밀도, 갈등 등)
 * ============================================================
 */
@Injectable()
export class SummarizationService {
  private readonly logger = new Logger(SummarizationService.name);

  /**
   * 증분 요약 실행
   *
   * @param existingSummary 기존 요약 (없으면 빈 문자열)
   * @param newMessages 요약할 새 메시지들
   * @returns 업데이트된 요약
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

    // ============================================================
    // TODO: 실제 LLM 호출로 교체
    //
    // 중요: 요약 전용으로 경량 모델 사용 (비용 절감)
    // - Gemini Flash: $0.075/1M input — Pro의 1/93 비용
    // - GPT-4o-mini: $0.15/1M input
    //
    // 요약은 품질보다 비용이 중요한 영역.
    // 메인 대화에는 Pro, 요약에는 Flash — 이 분리가 핵심.
    // ============================================================

    // 스텁 구현: 메시지를 단순 압축
    const summary = this.generateStubSummary(existingSummary, newMessages);
    return summary;
  }

  /**
   * 요약 프롬프트 구성
   */
  private buildSummarizationPrompt(
    existingSummary: string,
    messages: IChatMessage[],
  ): string {
    const parts: string[] = [];

    parts.push(
      '다음은 AI 캐릭터와 유저 간의 대화입니다. ' +
        '기존 요약을 기반으로 새 대화 내용을 통합하여 요약을 업데이트하세요.',
    );

    parts.push('\n[요약 규칙]');
    parts.push('1. 500토큰 이내로 작성');
    parts.push('2. 반드시 보존할 정보:');
    parts.push('   - 유저가 공유한 개인 정보 (이름, 취향, 관심사)');
    parts.push('   - 감정적 하이라이트 (기뻤던/슬펐던 순간)');
    parts.push('   - 캐릭터와의 관계 상태 (친밀도, 특별한 약속)');
    parts.push('   - 반복되는 대화 패턴이나 내부 농담');
    parts.push('3. 생략해도 되는 정보:');
    parts.push('   - 일상적 인사, 안부');
    parts.push('   - 중복되는 내용');
    parts.push('   - 맥락 없이는 의미 없는 짧은 반응');

    if (existingSummary) {
      parts.push(`\n[기존 요약]\n${existingSummary}`);
    }

    parts.push('\n[새 대화]');
    for (const msg of messages) {
      const role = msg.role === 'user' ? '유저' : '캐릭터';
      parts.push(`${role}: ${msg.content}`);
    }

    parts.push('\n[업데이트된 요약]');

    return parts.join('\n');
  }

  /**
   * 스텁 요약 (개발/테스트용)
   */
  private generateStubSummary(
    existingSummary: string,
    messages: IChatMessage[],
  ): string {
    const userMessages = messages.filter((m) => m.role === 'user');
    const topics = userMessages
      .map((m) => m.content.slice(0, 30))
      .join(', ');

    const newPart = `최근 ${messages.length}개 메시지에서 다룬 주제: ${topics}`;

    if (existingSummary) {
      return `${existingSummary}\n${newPart}`;
    }
    return newPart;
  }
}
