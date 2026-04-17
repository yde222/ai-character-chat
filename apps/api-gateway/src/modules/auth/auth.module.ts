import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from '@app/database';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { GoogleStrategy } from './strategies/google.strategy';
import { KakaoStrategy } from './strategies/kakao.strategy';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { WsJwtGuard } from './guards/ws-jwt.guard';

/**
 * Auth Module — 소셜 로그인 + JWT
 *
 * 인증 플로우:
 * 1. 클라이언트 → /auth/google (또는 /auth/kakao) 리다이렉트
 * 2. OAuth 프로바이더에서 인증 완료 → 콜백 URL로 리다이렉트
 * 3. 콜백에서 유저 생성/조회 → JWT 발급
 * 4. 클라이언트는 JWT를 WebSocket 연결 시 handshake에 포함
 *
 * 보안:
 * - JWT 만료: 7일 (모바일 UX — 매일 로그인은 이탈 유발)
 * - Phase 2: 리프레시 토큰 + Redis 블랙리스트
 */
@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get('JWT_SECRET', 'change-me-in-production'),
        signOptions: {
          expiresIn: config.get('JWT_EXPIRY', '7d'),
        },
      }),
    }),
    TypeOrmModule.forFeature([UserEntity]),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    GoogleStrategy,
    KakaoStrategy,
    JwtStrategy,
    JwtAuthGuard,
    WsJwtGuard,
  ],
  exports: [AuthService, JwtAuthGuard, WsJwtGuard, JwtModule],
})
export class AuthModule {}
