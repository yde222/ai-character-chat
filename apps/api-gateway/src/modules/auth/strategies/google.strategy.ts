import { Injectable, Logger } from '@nestjs/common';

/**
 * Google OAuth Strategy — 스텁 (로컬 개발용)
 *
 * passport-google-oauth20 네이티브 모듈 없이 컴파일 가능하도록
 * 스텁 처리. 실제 배포 시 passport-google-oauth20 설치 후 교체.
 *
 * 한국 시장 Google OAuth 점유율: ~25% (2024 기준)
 */
@Injectable()
export class GoogleStrategy {
  private readonly logger = new Logger(GoogleStrategy.name);

  constructor() {
    this.logger.warn('GoogleStrategy is a STUB — install passport-google-oauth20 for production');
  }
}
