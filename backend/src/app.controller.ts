import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get('health')
  getHealth(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
