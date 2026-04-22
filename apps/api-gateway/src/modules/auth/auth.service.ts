import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

export interface OAuthProfile {
  provider: string;
  providerId: string;
  email?: string;
  displayName: string;
  avatarUrl?: string;
}

export interface JwtPayload {
  sub: string;        // userId
  email: string;
  displayName: string;
  tier: string;
}

/**
 * MVP용 유저 인터페이스 (TypeORM Entity 대체)
 */
export interface MvpUser {
  id: string;
  provider: string;
  providerId: string;
  email: string;
  displayName: string;
  avatarUrl: string;
  tier: string;
  dailyMessageQuota: number;
  bonusMessages: number;
}

/**
 * Auth Service — MVP 경량 버전
 *
 * TypeORM 제거. 인메모리 유저 저장 + JWT 토큰 기반 인증.
 * Phase 2: PostgreSQL + TypeORM UserEntity 복구.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly users = new Map<string, MvpUser>();

  constructor(private readonly jwtService: JwtService) {}

  /**
   * OAuth 로그인/회원가입 (인메모리)
   */
  async validateOAuthUser(profile: OAuthProfile): Promise<MvpUser> {
    const key = `${profile.provider}:${profile.providerId}`;
    let user = this.users.get(key);

    if (!user) {
      user = {
        id: `user_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        provider: profile.provider,
        providerId: profile.providerId,
        email: profile.email || '',
        displayName: profile.displayName,
        avatarUrl: profile.avatarUrl || '',
        tier: 'free',
        dailyMessageQuota: 50,
        bonusMessages: 0,
      };
      this.users.set(key, user);
      this.logger.log(`New user created: ${user.displayName} (${profile.provider})`);
    }

    return user;
  }

  /**
   * JWT 발급
   */
  generateToken(user: MvpUser): { accessToken: string } {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      displayName: user.displayName,
      tier: user.tier,
    };

    return {
      accessToken: this.jwtService.sign(payload),
    };
  }

  /**
   * JWT 검증 — DB 조회 없이 페이로드에서 직접 유저 정보 반환
   */
  async validateJwtPayload(payload: JwtPayload): Promise<MvpUser> {
    return {
      id: payload.sub,
      provider: 'jwt',
      providerId: payload.sub,
      email: payload.email,
      displayName: payload.displayName,
      avatarUrl: '',
      tier: payload.tier,
      dailyMessageQuota: 50,
      bonusMessages: 0,
    };
  }

  /**
   * WebSocket 핸드셰이크 토큰 검증
   */
  verifyToken(token: string): JwtPayload | null {
    try {
      return this.jwtService.verify<JwtPayload>(token);
    } catch {
      return null;
    }
  }
}
