// ============================================================
// 서비스 간 공유 상수
// ============================================================

// gRPC 서비스 패키지명
export const CHAT_PACKAGE = 'chat';
export const IMAGE_PACKAGE = 'image';

// gRPC 서비스명
export const CHAT_SERVICE = 'ChatService';
export const IMAGE_MATCHING_SERVICE = 'ImageMatchingService';

// Kafka 토픽
export const KAFKA_TOPICS = {
  CHAT_MESSAGE_SENT: 'chat.message.sent',
  CHAT_SESSION_CREATED: 'chat.session.created',
  USER_ATTENDANCE: 'user.attendance.checked',
  BADGE_EARNED: 'badge.earned',
  PAYMENT_COMPLETED: 'payment.completed',
  NOTIFICATION_TRIGGER: 'notification.trigger',
} as const;

// Redis 키 프리픽스
export const REDIS_PREFIX = {
  SESSION_CONTEXT: 'ctx:session:',
  CONTEXT_SUMMARY: 'ctx:summary:',
  ASSET_INDEX: 'asset:idx:',
  ASSET_CACHE: 'asset:cache:',
  USER_DAILY_COUNT: 'user:daily:',
  RATE_LIMIT: 'rate:',
  ATTENDANCE: 'attend:',
} as const;

// LLM 설정
export const LLM_CONFIG = {
  // 컨텍스트 윈도우 관리
  MAX_CONTEXT_TOKENS: 8192,
  RECENT_TURNS_TO_KEEP: 5,
  SUMMARY_MAX_TOKENS: 500,
  // 응답 설정
  MAX_RESPONSE_TOKENS: 1024,
  TEMPERATURE: 0.8,
  // Circuit Breaker
  FAILURE_THRESHOLD: 5,
  RECOVERY_TIMEOUT_MS: 30000,
  // 비용 관리
  FREE_DAILY_MESSAGES: 50,
  PREMIUM_DAILY_MESSAGES: -1, // 무제한
} as const;

// 감정 태그 (Proto enum과 동기화)
export enum EmotionTag {
  NEUTRAL = 0,
  JOY = 1,
  SADNESS = 2,
  ANGER = 3,
  SURPRISE = 4,
  AFFECTION = 5,
  FEAR = 6,
  DISGUST = 7,
  EXCITEMENT = 8,
  SHY = 9,
}

// 감정 태그 → 한글 매핑 (프롬프트 엔지니어링용)
export const EMOTION_LABELS: Record<EmotionTag, string> = {
  [EmotionTag.NEUTRAL]: '중립',
  [EmotionTag.JOY]: '기쁨',
  [EmotionTag.SADNESS]: '슬픔',
  [EmotionTag.ANGER]: '분노',
  [EmotionTag.SURPRISE]: '놀람',
  [EmotionTag.AFFECTION]: '애정',
  [EmotionTag.FEAR]: '두려움',
  [EmotionTag.DISGUST]: '불쾌',
  [EmotionTag.EXCITEMENT]: '흥분',
  [EmotionTag.SHY]: '수줍음',
};
