import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService, JwtPayload } from '../auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private readonly config: ConfigService,
    private readonly authService: AuthService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_SECRET', 'change-me-in-production'),
    });
  }

  /**
   * MVP: DB 조회 없이 JWT 페이로드에서 직접 유저 정보 생성.
   * JWT가 유효하면 (서명 + 만료 검증 통과) 그 자체가 인증.
   */
  async validate(payload: JwtPayload) {
    return this.authService.validateJwtPayload(payload);
  }
}
