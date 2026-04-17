import { Injectable, Logger } from '@nestjs/common';
import { CircuitState, ICircuitBreakerState } from '@app/common/interfaces';
import { LLM_CONFIG } from '@app/common/constants';

/**
 * Circuit Breaker — LLM API 장애 방어
 *
 * 왜 필요한가:
 * Gemini든 Claude든 외부 API 장애 시 전체 채팅 서비스가 멈추는 걸 방지.
 * 경쟁사 전부 이 방어 없이 운영 중 → 장애 시 전체 다운.
 *
 * 동작 원리:
 * CLOSED (정상) → 실패 5회 누적 → OPEN (차단, fallback 모델 사용)
 * → 30초 후 → HALF_OPEN (복구 시도) → 성공 → CLOSED
 *                                     → 실패 → OPEN
 *
 * 성공 사례 참고:
 * Netflix Hystrix (현재는 Resilience4j) — 마이크로서비스 장애 전파 차단
 * 같은 패턴을 LLM API 레이어에 적용
 */
@Injectable()
export class CircuitBreakerService {
  private readonly logger = new Logger(CircuitBreakerService.name);

  // 모델별 독립 Circuit Breaker
  private circuits = new Map<string, ICircuitBreakerState>();

  getState(modelId: string): ICircuitBreakerState {
    if (!this.circuits.has(modelId)) {
      this.circuits.set(modelId, {
        state: CircuitState.CLOSED,
        failureCount: 0,
        lastFailureTime: 0,
        successCount: 0,
      });
    }
    return this.circuits.get(modelId)!;
  }

  /**
   * 요청 가능 여부 판단
   */
  canRequest(modelId: string): boolean {
    const circuit = this.getState(modelId);

    switch (circuit.state) {
      case CircuitState.CLOSED:
        return true;

      case CircuitState.OPEN:
        // 복구 타임아웃 경과 → HALF_OPEN 전환
        if (Date.now() - circuit.lastFailureTime >= LLM_CONFIG.RECOVERY_TIMEOUT_MS) {
          circuit.state = CircuitState.HALF_OPEN;
          circuit.successCount = 0;
          this.logger.warn(`Circuit HALF_OPEN for ${modelId} — recovery attempt`);
          return true;
        }
        return false;

      case CircuitState.HALF_OPEN:
        // HALF_OPEN에서는 1개 요청만 허용
        return circuit.successCount === 0;

      default:
        return true;
    }
  }

  /**
   * 성공 기록
   */
  recordSuccess(modelId: string): void {
    const circuit = this.getState(modelId);

    if (circuit.state === CircuitState.HALF_OPEN) {
      circuit.successCount++;
      // 3번 연속 성공 시 CLOSED 복귀
      if (circuit.successCount >= 3) {
        circuit.state = CircuitState.CLOSED;
        circuit.failureCount = 0;
        this.logger.log(`Circuit CLOSED for ${modelId} — recovered`);
      }
    } else if (circuit.state === CircuitState.CLOSED) {
      // 성공 시 실패 카운트 감소 (점진적 회복)
      circuit.failureCount = Math.max(0, circuit.failureCount - 1);
    }
  }

  /**
   * 실패 기록
   */
  recordFailure(modelId: string): void {
    const circuit = this.getState(modelId);
    circuit.failureCount++;
    circuit.lastFailureTime = Date.now();

    if (circuit.state === CircuitState.HALF_OPEN) {
      // 복구 실패 → 다시 OPEN
      circuit.state = CircuitState.OPEN;
      this.logger.error(`Circuit OPEN for ${modelId} — recovery failed`);
    } else if (circuit.failureCount >= LLM_CONFIG.FAILURE_THRESHOLD) {
      circuit.state = CircuitState.OPEN;
      this.logger.error(
        `Circuit OPEN for ${modelId} — ${circuit.failureCount} failures`,
      );
    }
  }

  /**
   * 전체 상태 조회 (모니터링/헬스체크용)
   */
  getAllStates(): Record<string, ICircuitBreakerState> {
    const states: Record<string, ICircuitBreakerState> = {};
    this.circuits.forEach((state, modelId) => {
      states[modelId] = { ...state };
    });
    return states;
  }
}
