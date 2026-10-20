import { reminderSentForCycle } from './reminder-cycle';

describe('reminderSentForCycle', () => {
  const cycle = new Date('2026-11-01T12:00:00.000Z');

  it('is false without any reminder', () => {
    expect(reminderSentForCycle([], cycle)).toBe(false);
  });

  it('is false when the only reminder belongs to an earlier cycle', () => {
    const earlier = new Date('2026-10-02T12:00:00.000Z');
    expect(reminderSentForCycle([{ expiresAt: earlier }], cycle)).toBe(false);
  });

  it('is true when a reminder was sent for this cycle', () => {
    const earlier = new Date('2026-10-02T12:00:00.000Z');
    const reminders = [{ expiresAt: earlier }, { expiresAt: new Date(cycle) }];
    expect(reminderSentForCycle(reminders, cycle)).toBe(true);
  });

  it('ignores reminders without a stored date', () => {
    expect(reminderSentForCycle([{ expiresAt: null }], cycle)).toBe(false);
  });
});
