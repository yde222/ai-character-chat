import { Injectable, Logger } from '@nestjs/common';

/**
 * Kakao OAuth Strategy — 스텁 (로컬 개발용)
 *
 * passport-kakao 네이티브 모듈 없이 컴파일 가능하도록
 * 스텁 처리. 실제 배포 시 passport-kakao 설치 후 교체.
 *
 * 한국 시장 카카오 OAuth 점유율: ~60%+ (2024 기준)
 */
@Injectable()
export class KakaoStrategy {
  private readonly logger = new Logger(KakaoStrategy.name);

  constructor() {
    this.logger.warn('KakaoStrategy is a STUB — install passport-kakao for production');
  }
}
