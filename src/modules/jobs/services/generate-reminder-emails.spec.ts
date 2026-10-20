import { EmailType } from 'src/generated/prisma/client';
import type { PrismaService } from 'src/core/prisma.service';
import type { ConfigCacheService } from 'src/core/config-cache.service';
import type { JobRunService } from './job-run.service';
import type { EmailTransportService } from './emailTransport.service';
import type { EmailTemplateService } from './email-template.service';
import { GenerateExpiryEmailsService } from './generate-expiry-emails.service';
import { GenerateDeletionEmailsService } from './generate-deletion-emails.service';

// The services import their dependencies for Nest's DI metadata. The real ones pull in the
// .tsx email templates and Prisma/Nest wiring that Jest is not set up for; the specs pass
// plain mocks to the constructor instead.
jest.mock('./email-template.service', () => ({
  EmailTemplateService: class {},
}));
jest.mock('./emailTransport.service', () => ({
  EmailTransportService: class {},
}));
jest.mock('./job-run.service', () => ({ JobRunService: class {} }));
jest.mock('src/core/prisma.service', () => ({ PrismaService: class {} }));
jest.mock('src/core/config-cache.service', () => ({
  ConfigCacheService: class {},
}));

// Both jobs query the 1-day window first, then the 7-day window. These specs put the servers in
// the 1-day window and check that a reminder goes out again once the server is in a new cycle.

const DELETE_AFTER_DAYS = 90;

function server(id: string, expires: Date, reminderDates: Date[]) {
  return {
    id,
    name: `Server ${id}`,
    expires,
    ptServerId: `pt-${id}`,
    type: 'FREE',
    userId: `user-${id}`,
    user: { name: `User ${id}`, email: `${id}@example.com` },
    Email: reminderDates.map((expiresAt) => ({ expiresAt })),
  };
}

function setup(oneDayWindow: ReturnType<typeof server>[]) {
  const findMany = jest
    .fn()
    .mockResolvedValueOnce(oneDayWindow)
    .mockResolvedValueOnce([]);
  const prisma = { gameServer: { findMany } } as unknown as PrismaService;
  const jobRunService = {
    startJobRun: jest.fn().mockResolvedValue({ jobRunId: 1 }),
    logInfo: jest.fn(),
    logError: jest.fn(),
    completeJobRun: jest.fn(),
    failJobRun: jest.fn(),
  };
  const emailService = {
    createEmail: jest.fn<Promise<void>, [{ gameServerId: string }]>(),
  };
  const templateService = {
    renderExpiryEmail: jest.fn().mockResolvedValue('<html>'),
    renderDeletionEmail: jest.fn().mockResolvedValue('<html>'),
  };
  const configCache = {
    getDeleteGameserverAfterDays: jest
      .fn()
      .mockResolvedValue(DELETE_AFTER_DAYS),
  };
  const deps = [
    prisma,
    jobRunService as unknown as JobRunService,
    emailService as unknown as EmailTransportService,
    templateService as unknown as EmailTemplateService,
    configCache as unknown as ConfigCacheService,
  ] as const;
  return { deps, jobRunService, emailService };
}

function deletionDateOf(expires: Date) {
  const deletionDate = new Date(expires);
  deletionDate.setDate(deletionDate.getDate() + DELETE_AFTER_DAYS);
  return deletionDate;
}

describe('GenerateExpiryEmailsService', () => {
  const previousExpiry = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000);
  const currentExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

  it('reminds an extended server again and skips one already reminded this cycle', async () => {
    const extended = server('extended', currentExpiry, [previousExpiry]);
    const reminded = server('reminded', currentExpiry, [currentExpiry]);
    const fresh = server('fresh', currentExpiry, []);
    const { deps, jobRunService, emailService } = setup([
      extended,
      reminded,
      fresh,
    ]);

    await new GenerateExpiryEmailsService(...deps).run();

    const sentTo = emailService.createEmail.mock.calls.map(
      ([email]) => email.gameServerId,
    );
    expect(sentTo).toEqual(['extended', 'fresh']);
    expect(emailService.createEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        type: EmailType.GAME_SERVER_EXPIRING_1_DAY,
        expiresAt: currentExpiry,
      }),
    );
    // total counts only what was due, so the dashboard shows 2/2, not 2/3
    expect(jobRunService.completeJobRun).toHaveBeenCalledWith(1, {
      processed: 2,
      total: 2,
      failed: 0,
    });
  });
});

describe('GenerateDeletionEmailsService', () => {
  const previousExpiry = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);
  const currentExpiry = new Date(
    Date.now() - (DELETE_AFTER_DAYS - 1) * 24 * 60 * 60 * 1000,
  );

  it('reminds again after a new expiry and skips one already reminded this cycle', async () => {
    const extended = server('extended', currentExpiry, [
      deletionDateOf(previousExpiry),
    ]);
    const reminded = server('reminded', currentExpiry, [
      deletionDateOf(currentExpiry),
    ]);
    const { deps, jobRunService, emailService } = setup([extended, reminded]);

    await new GenerateDeletionEmailsService(...deps).run();

    expect(emailService.createEmail).toHaveBeenCalledTimes(1);
    expect(emailService.createEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        gameServerId: 'extended',
        type: EmailType.GAME_SERVER_DELETION_1_DAY,
        expiresAt: deletionDateOf(currentExpiry),
      }),
    );
    expect(jobRunService.completeJobRun).toHaveBeenCalledWith(1, {
      processed: 1,
      total: 1,
      failed: 0,
    });
  });
});
