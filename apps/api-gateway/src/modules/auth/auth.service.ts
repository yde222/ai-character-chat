import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity } from '@app/database';

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
 * Auth Service
 *
 * 핵심 로직:
 * - OAuth 콜백에서 유저 생성 또는 기존 유저 조회 (upsert)
 * - JWT 토큰 발급
 * - 토큰 검증 (JwtStrategy에서 호출)
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly jwtService: JwtService,
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
  ) {}

  /**
   * OAuth 로그인/회원가입
   *
   * 기존 유저: provider + providerId로 조회 → 로그인
   * 신규 유저: 자동 생성 → 회원가입 + 로그인
   */
  async validateOAuthUser(profile: OAuthProfile): Promise<UserEntity> {
    let user = await this.userRepo.findOneBy({
      provider: profile.provider,
      providerId: profile.providerId,
    });

    if (!user) {
      user = this.userRepo.create({
        provider: profile.provider,
        providerId: profile.providerId,
        email: profile.email || '',
        displayName: profile.displayName,
        avatarUrl: profile.avatarUrl || '',
        tier: 'free',
        dailyMessageQuota: 50,
        bonusMessages: 0,
        lastLoginAt: new Date(),
      });
      await this.userRepo.save(user);
      this.logger.log(`New user created: ${user.displayName} (${profile.provider})`);
    } else {
      user.lastLoginAt = new Date();
      await this.userRepo.save(user);
    }

    return user;
  }

  /**
   * JWT 발급
   */
  generateToken(user: UserEntity): { accessToken: string } {
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
   * JWT 검증 (JwtStrategy에서 호출)
   */
  async validateJwtPayload(payload: JwtPayload): Promise<UserEntity | null> {
    return this.userRepo.findOneBy({ id: payload.sub });
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
