// ============================================================
// 공유 유틸리티
// ============================================================

/**
 * 간이 토큰 카운터 (정밀도보다 속도 우선)
 * 한글 1글자 ≈ 2~3토큰, 영어 1단어 ≈ 1토큰 기준
 * 정밀 측정이 필요하면 tiktoken 사용
 */
export function estimateTokenCount(text: string): number {
  const koreanChars = (text.match(/[\uAC00-\uD7AF]/g) || []).length;
  const otherChars = text.length - koreanChars;
  return Math.ceil(koreanChars * 2.5 + otherChars * 0.4);
}

/**
 * 지연 측정 유틸리티
 */
export function measureLatency(): () => number {
  const start = process.hrtime.bigint();
  return () => Number(process.hrtime.bigint() - start) / 1_000_000; // ms
}

/**
 * 재시도 유틸리티 (지수 백오프)
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
  } = {},
): Promise<T> {
  const { maxRetries = 3, baseDelayMs = 200, maxDelayMs = 5000 } = options;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries) throw error;
      const delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
      const jitter = delay * (0.5 + Math.random() * 0.5);
      await new Promise((resolve) => setTimeout(resolve, jitter));
    }
  }
  throw new Error('Unreachable');
}
