import { Injectable, Logger } from '@nestjs/common';

/**
 * Story Choice Service — 스토리 선택지 생성 엔진
 *
 * 핵심 설계:
 * 1. AI 응답의 감정 + 호감도 레벨 기반으로 선택지 자동 생성
 * 2. 선택지마다 호감도 영향 (positive/neutral/negative) 명시
 * 3. 레벨이 높을수록 임팩트 큰 선택지 등장 (고백, 스킨십 등)
 *
 * 성공 사례: "러브 앤 프로듀서" (Papergames)
 * - 대화 5턴마다 선택지 → DAU 대비 세션 시간 42% 증가
 * - 선택지 없는 대화 vs 있는 대화 리텐션 차이: +18%p
 *
 * Phase 1: 규칙 기반 템플릿 선택지
 * Phase 2: LLM으로 컨텍스트 인식 동적 생성
 */

interface ChoiceTemplate {
  id: string;
  text: string;
  emoji: string;
  effect: 'positive' | 'neutral' | 'negative';
  affinityDelta: number;
  affinityHint: string;
  minLevel?: string;
}

// 감정별 × 레벨별 선택지 풀
const CHOICE_TEMPLATES: Record<string, ChoiceTemplate[]> = {
  // ===== 긍정 감정 (JOY, EXCITEMENT, AFFECTION) =====
  positive_low: [
    { id: 'p_low_1', text: '나도 기분 좋아졌어', emoji: '😊', effect: 'positive', affinityDelta: 2, affinityHint: '호감 UP' },
    { id: 'p_low_2', text: '그렇구나, 다행이다', emoji: '🙂', effect: 'neutral', affinityDelta: 1, affinityHint: '' },
    { id: 'p_low_3', text: '음... 그래?', emoji: '🤔', effect: 'negative', affinityDelta: -1, affinityHint: '' },
  ],
  positive_mid: [
    { id: 'p_mid_1', text: '너랑 있으면 나도 행복해', emoji: '💕', effect: 'positive', affinityDelta: 3, affinityHint: '호감 UP' },
    { id: 'p_mid_2', text: '오늘 정말 즐거웠어', emoji: '✨', effect: 'neutral', affinityDelta: 1, affinityHint: '' },
    { id: 'p_mid_3', text: '좀 오버하는 거 아니야?', emoji: '😅', effect: 'negative', affinityDelta: -2, affinityHint: '호감 DOWN' },
  ],
  positive_high: [
    { id: 'p_high_1', text: '솔직히... 너한테 빠진 것 같아', emoji: '🥰', effect: 'positive', affinityDelta: 5, affinityHint: '호감 대폭 UP', minLevel: 'CLOSE' },
    { id: 'p_high_2', text: '이 순간이 영원했으면 좋겠다', emoji: '💫', effect: 'positive', affinityDelta: 3, affinityHint: '호감 UP' },
    { id: 'p_high_3', text: '고마워, 근데 좀 쑥스럽다', emoji: '😳', effect: 'neutral', affinityDelta: 1, affinityHint: '' },
  ],

  // ===== 부정 감정 (SADNESS, ANGER, FEAR) =====
  negative_low: [
    { id: 'n_low_1', text: '괜찮아? 내가 도와줄까?', emoji: '🤗', effect: 'positive', affinityDelta: 3, affinityHint: '호감 UP' },
    { id: 'n_low_2', text: '힘든 일 있었구나...', emoji: '😢', effect: 'neutral', affinityDelta: 1, affinityHint: '' },
    { id: 'n_low_3', text: '에이, 별거 아닐 거야', emoji: '😒', effect: 'negative', affinityDelta: -2, affinityHint: '호감 DOWN' },
  ],
  negative_mid: [
    { id: 'n_mid_1', text: '내가 옆에 있을게. 언제든.', emoji: '💪', effect: 'positive', affinityDelta: 4, affinityHint: '호감 UP' },
    { id: 'n_mid_2', text: '천천히 얘기해줘', emoji: '🫂', effect: 'neutral', affinityDelta: 2, affinityHint: '' },
    { id: 'n_mid_3', text: '그건 네 잘못 아니야?', emoji: '😐', effect: 'negative', affinityDelta: -3, affinityHint: '호감 DOWN' },
  ],
  negative_high: [
    { id: 'n_high_1', text: '울어도 괜찮아. 내가 안아줄게.', emoji: '🫂', effect: 'positive', affinityDelta: 5, affinityHint: '호감 대폭 UP', minLevel: 'CLOSE' },
    { id: 'n_high_2', text: '같이 해결하자, 우리 둘이면 할 수 있어', emoji: '🔥', effect: 'positive', affinityDelta: 3, affinityHint: '호감 UP' },
    { id: 'n_high_3', text: '시간이 해결해줄 거야', emoji: '⏰', effect: 'neutral', affinityDelta: 0, affinityHint: '' },
  ],

  // ===== 수줍음/놀라움 (SHY, SURPRISE) =====
  shy_low: [
    { id: 's_low_1', text: '귀엽다... 왜 그렇게 빨개져?', emoji: '😏', effect: 'positive', affinityDelta: 3, affinityHint: '호감 UP' },
    { id: 's_low_2', text: '나도 좀 쑥스러워졌어', emoji: '😊', effect: 'neutral', affinityDelta: 2, affinityHint: '' },
    { id: 's_low_3', text: '왜 그래, 무슨 일 있어?', emoji: '❓', effect: 'neutral', affinityDelta: 0, affinityHint: '' },
  ],
  shy_high: [
    { id: 's_high_1', text: '(손을 살짝 잡는다)', emoji: '🤝', effect: 'positive', affinityDelta: 5, affinityHint: '호감 대폭 UP', minLevel: 'FRIEND' },
    { id: 's_high_2', text: '그 표정 좋아, 더 보여줘', emoji: '💖', effect: 'positive', affinityDelta: 3, affinityHint: '호감 UP' },
    { id: 's_high_3', text: '하하, 귀여워', emoji: '😄', effect: 'neutral', affinityDelta: 1, affinityHint: '' },
  ],

  // ===== 중립 =====
  neutral: [
    { id: 'neu_1', text: '더 자세히 알려줘', emoji: '👀', effect: 'neutral', affinityDelta: 1, affinityHint: '' },
    { id: 'neu_2', text: '나도 비슷한 경험이 있어', emoji: '💬', effect: 'positive', affinityDelta: 2, affinityHint: '호감 UP' },
    { id: 'neu_3', text: '음, 그렇구나', emoji: '🙂', effect: 'neutral', affinityDelta: 0, affinityHint: '' },
  ],
};

// 선택지 등장 확률: 매 대화가 아닌 N턴마다
const CHOICE_INTERVAL = 3; // 3턴마다 선택지 등장

@Injectable()
export class StoryChoiceService {
  private readonly logger = new Logger(StoryChoiceService.name);
  private turnCounter = new Map<string, number>();

  /**
   * 선택지 생성 여부 판단 + 생성
   *
   * @returns 선택지 배열 (빈 배열이면 이번 턴은 선택지 없음)
   */
  generateChoices(
    sessionId: string,
    emotion: string,
    affinityLevel: string,
  ): { id: string; text: string; emoji: string; effect: string; affinityHint: string }[] {
    // 턴 카운터 증가
    const count = (this.turnCounter.get(sessionId) || 0) + 1;
    this.turnCounter.set(sessionId, count);

    // N턴마다만 선택지 등장
    if (count % CHOICE_INTERVAL !== 0) {
      return [];
    }

    // 감정 분류
    const emotionGroup = this.classifyEmotion(emotion);
    const levelGroup = this.classifyLevel(affinityLevel);

    // 템플릿 키 결정
    let templateKey: string;
    if (emotionGroup === 'positive') {
      templateKey = `positive_${levelGroup}`;
    } else if (emotionGroup === 'negative') {
      templateKey = `negative_${levelGroup}`;
    } else if (emotionGroup === 'shy') {
      templateKey = levelGroup === 'high' ? 'shy_high' : 'shy_low';
    } else {
      templateKey = 'neutral';
    }

    const templates = CHOICE_TEMPLATES[templateKey] || CHOICE_TEMPLATES.neutral;

    // minLevel 필터링
    const levelOrder = ['STRANGER', 'ACQUAINTANCE', 'FRIEND', 'CLOSE', 'INTIMATE', 'SOULMATE'];
    const currentLevelIdx = levelOrder.indexOf(affinityLevel);

    const filtered = templates.filter((t) => {
      if (!t.minLevel) return true;
      return currentLevelIdx >= levelOrder.indexOf(t.minLevel);
    });

    // 최소 2개 보장 (필터링으로 줄어들면 neutral에서 보충)
    if (filtered.length < 2) {
      const neutralChoices = CHOICE_TEMPLATES.neutral;
      while (filtered.length < 2 && neutralChoices.length > 0) {
        filtered.push(neutralChoices[filtered.length % neutralChoices.length]);
      }
    }

    this.logger.log(
      `선택지 생성: session=${sessionId}, emotion=${emotion}, level=${affinityLevel}, choices=${filtered.length}`,
    );

    return filtered.map((t) => ({
      id: `${t.id}_${Date.now()}`,
      text: t.text,
      emoji: t.emoji,
      effect: t.effect,
      affinityHint: t.affinityHint,
    }));
  }

  /**
   * 선택 결과 → 호감도 변동값 반환
   */
  getChoiceAffinityDelta(choiceId: string): number {
    // choiceId에서 템플릿 ID 추출 (타임스탬프 제거)
    const templateId = choiceId.replace(/_\d+$/, '');

    for (const templates of Object.values(CHOICE_TEMPLATES)) {
      const found = templates.find((t) => t.id === templateId);
      if (found) return found.affinityDelta;
    }

    return 0;
  }

  /**
   * 세션 정리
   */
  clearSession(sessionId: string): void {
    this.turnCounter.delete(sessionId);
  }

  private classifyEmotion(emotion: string): 'positive' | 'negative' | 'shy' | 'neutral' {
    const positive = ['JOY', 'AFFECTION', 'EXCITEMENT'];
    const negative = ['SADNESS', 'ANGER', 'FEAR', 'DISGUST'];
    const shy = ['SHY', 'SURPRISE'];

    if (positive.includes(emotion)) return 'positive';
    if (negative.includes(emotion)) return 'negative';
    if (shy.includes(emotion)) return 'shy';
    return 'neutral';
  }

  private classifyLevel(level: string): 'low' | 'mid' | 'high' {
    const low = ['STRANGER', 'ACQUAINTANCE'];
    const mid = ['FRIEND', 'CLOSE'];
    // high: INTIMATE, SOULMATE
    if (low.includes(level)) return 'low';
    if (mid.includes(level)) return 'mid';
    return 'high';
  }
}
