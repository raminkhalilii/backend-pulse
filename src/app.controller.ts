import { Controller, Get, HttpCode } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  /**
   * Health-check endpoint — GET /health
   *
   * Deliberately NOT under the /api prefix (excluded in main.ts via setGlobalPrefix).
   * Deliberately NOT behind any auth guard.
   *
   * Used by:
   *   - Docker Compose healthcheck (container marked healthy only after this passes)
   *   - Nginx upstream check (proxy_next_upstream retries until it gets 200)
   *   - GitHub Actions deploy script (health gate before marking deploy as done)
   */
  @Get('health')
  @HttpCode(200)
  health(): { status: string; timestamp: string; uptime: number } {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }
}
