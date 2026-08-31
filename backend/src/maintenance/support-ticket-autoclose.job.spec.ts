import { SupportTicketAutocloseJob } from './support-ticket-autoclose.job';
import { SupportTicketAutocloseService } from './support-ticket-autoclose.service';
import { ConfigService } from '@nestjs/config';

jest.mock('../redis/client', () => ({
  getBullMQConnection: jest.fn().mockReturnValue({ on: jest.fn() }),
}));

describe('SupportTicketAutocloseJob', () => {
  it('schedules with default cron when config missing', async () => {
    const mockConfig = {
      get: jest.fn().mockReturnValue(null),
    } as unknown as ConfigService;

    const mockService = {
      autoCloseInactiveTickets: jest.fn(),
    } as unknown as SupportTicketAutocloseService;

    const job = new SupportTicketAutocloseJob(mockConfig, mockService);
    await job.onModuleInit();

    expect(mockConfig.get).toHaveBeenCalledWith('SUPPORT_TICKET_AUTOCLOSE_CRON');
  });

  it('schedules with configured cron pattern', async () => {
    const mockConfig = {
      get: jest.fn().mockReturnValue('0 12 * * *'),
    } as unknown as ConfigService;

    const mockService = {
      autoCloseInactiveTickets: jest.fn(),
    } as unknown as SupportTicketAutocloseService;

    const job = new SupportTicketAutocloseJob(mockConfig, mockService);
    await job.onModuleInit();

    expect(mockConfig.get).toHaveBeenCalledWith('SUPPORT_TICKET_AUTOCLOSE_CRON');
  });
});
