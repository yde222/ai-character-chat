import { Controller, Get, Req, Res, UseGuards, Logger } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';

/**
 * Auth Controller — OAuth 콜백 엔드포인트
 *
 * 플로우:
 * GET /auth/google → Google OAuth 페이지로 리다이렉트
 * GET /auth/google/callback → 인증 완료 후 JWT 발급
 * GET /auth/kakao → Kakao OAuth 페이지로 리다이렉트
 * GET /auth/kakao/callback → 인증 완료 후 JWT 발급
 */
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private readonly authService: AuthService) {}

  // ============================================================
  // Google OAuth
  // ============================================================

  @Get('google')
  @UseGuards(AuthGuard('google'))
  googleLogin() {
    // Passport가 Google로 리다이렉트 처리
  }

  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleCallback(@Req() req: any, @Res() res: any) {
    const { accessToken } = this.authService.generateToken(req.user);
    this.logger.log(`Google login: ${req.user.displayName}`);

    // 클라이언트 앱으로 리다이렉트 (토큰 포함)
    const clientUrl = process.env.CLIENT_REDIRECT_URL || 'http://localhost:3001';
    res.redirect(`${clientUrl}/auth/callback?token=${accessToken}`);
  }

  // ============================================================
  // Kakao OAuth
  // ============================================================

  @Get('kakao')
  @UseGuards(AuthGuard('kakao'))
  kakaoLogin() {
    // Passport가 Kakao로 리다이렉트 처리
  }

  @Get('kakao/callback')
  @UseGuards(AuthGuard('kakao'))
  async kakaoCallback(@Req() req: any, @Res() res: any) {
    const { accessToken } = this.authService.generateToken(req.user);
    this.logger.log(`Kakao login: ${req.user.displayName}`);

    const clientUrl = process.env.CLIENT_REDIRECT_URL || 'http://localhost:3001';
    res.redirect(`${clientUrl}/auth/callback?token=${accessToken}`);
  }

  // ============================================================
  // Token 검증 (클라이언트 토큰 갱신용)
  // ============================================================

  @Get('me')
  @UseGuards(AuthGuard('jwt'))
  getProfile(@Req() req: any) {
    return {
      id: req.user.id,
      displayName: req.user.displayName,
      email: req.user.email,
      avatarUrl: req.user.avatarUrl,
      tier: req.user.tier,
      dailyMessageQuota: req.user.dailyMessageQuota,
      bonusMessages: req.user.bonusMessages,
    };
  }
}
