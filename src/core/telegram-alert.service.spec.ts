import { LogLevel } from '../generated/prisma/client';
import {
  AlertEntry,
  render,
  TelegramAlertService,
} from './telegram-alert.service';
import type { TelegramClient } from './telegram.client';

function entry(overrides: Partial<AlertEntry> = {}): AlertEntry {
  return {
    level: LogLevel.ERROR,
    message: 'Provisioning failed',
    details: null,
    instanceId: 'worker-1',
    component: 'ProvisioningProcessor',
    jobRunId: null,
    gameServerId: null,
    userId: null,
    createdAt: new Date('2026-11-25T12:00:00Z'),
    ...overrides,
  };
}

describe('TelegramAlertService', () => {
  let send: jest.Mock;
  let alerts: TelegramAlertService;

  beforeEach(() => {
    jest.useFakeTimers();
    send = jest.fn().mockResolvedValue(true);
    alerts = new TelegramAlertService({
      isConfigured: true,
      send,
    } as unknown as TelegramClient);
  });

  afterEach(() => jest.useRealTimers());

  it('bundles errors that arrive close together into one message', async () => {
    alerts.push(entry({ message: 'a' }));
    await jest.advanceTimersByTimeAsync(1_000);
    alerts.push(entry({ message: 'b' }));
    await jest.advanceTimersByTimeAsync(1_000);
    alerts.push(entry({ message: 'a' }));

    expect(send).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(3_000);

    expect(send).toHaveBeenCalledTimes(1);
    const text = send.mock.calls[0][0] as string;
    expect(text).toContain('<b>3 errors</b>');
    expect(text).toContain('<b>×2</b>');
  });

  it('does not hold the first error back past the max wait', async () => {
    for (let i = 0; i < 20; i++) {
      alerts.push(entry());
      await jest.advanceTimersByTimeAsync(1_000);
    }
    // Errors kept arriving every second, yet one batch went out at 15s.
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('sends FATAL lines almost immediately, even if errors follow', async () => {
    alerts.push(entry({ level: LogLevel.FATAL }));
    await jest.advanceTimersByTimeAsync(200);
    alerts.push(entry());
    await jest.advanceTimersByTimeAsync(400);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('keeps a cooldown between consecutive messages', async () => {
    alerts.push(entry({ level: LogLevel.FATAL }));
    await jest.advanceTimersByTimeAsync(600);
    expect(send).toHaveBeenCalledTimes(1);

    alerts.push(entry({ level: LogLevel.FATAL }));
    await jest.advanceTimersByTimeAsync(600);
    expect(send).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(5_000);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('sends pending lines on flush', async () => {
    alerts.push(entry());
    await alerts.flush();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('does nothing when Telegram is not configured', async () => {
    alerts = new TelegramAlertService({
      isConfigured: false,
      send,
    } as unknown as TelegramClient);
    alerts.push(entry());
    await alerts.flush();
    expect(send).not.toHaveBeenCalled();
  });
});

describe('render', () => {
  it('formats a single error with its resources, error and stack', () => {
    const text = render([
      entry({
        gameServerId: 'srv_1',
        userId: 'usr_1',
        details: {
          error: { name: 'TypeError', message: 'x is <undefined>', stack: '' },
          stack: 'TypeError: x\n    at run (/app/dist/a.js:1:1)',
          orderId: 42,
        },
      }),
    ]);

    expect(text).toContain(
      '🔴 <b>ERROR</b> · <code>ProvisioningProcessor</code>',
    );
    expect(text).toContain('<code>srv_1</code>');
    expect(text).toContain('TypeError: x is &lt;undefined&gt;');
    expect(text).toContain('at run (/app/dist/a.js:1:1)');
    expect(text).toContain('&quot;orderId&quot;: 42');
  });

  it('stays within the Telegram length limit', () => {
    const huge = 'x'.repeat(10_000);
    const single = render([
      entry({
        message: huge,
        details: { error: huge, stack: huge, blob: huge },
      }),
    ]);
    expect(single.length).toBeLessThanOrEqual(4096);

    const many = Array.from({ length: 300 }, (_, i) =>
      entry({ message: `${i} ${'y'.repeat(150)}` }),
    );
    const batch = render(many);
    expect(batch.length).toBeLessThanOrEqual(4096);
    expect(batch).toContain('more distinct errors');
  });
});
