import { Controller, Get } from '@nestjs/common';

/**
 * Health Check — K8s liveness/readiness probe + 모니터링
 */
@Controller('health')
export class HealthController {
  @Get()
  check() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }

  @Get('ready')
  readiness() {
    // TODO: gRPC 연결 상태, Redis 연결 상태 체크
    return { status: 'ready' };
  }
}
