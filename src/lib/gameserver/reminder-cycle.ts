import { EmailType, Prisma } from 'src/generated/prisma/client';

/**
 * Reminder emails (expiry, deletion) belong to one lifecycle *cycle* of a server: the
 * expiry date, or the deletion date derived from it, that they announce. The email stores
 * that date in `Email.expiresAt`.
 *
 * A server that gets extended starts a new cycle and must be reminded again. Filtering on
 * `Email: { none: { type } }` alone would see the reminder of the first cycle and never
 * send another one. Prisma cannot compare a relation's column with the parent's column in
 * a `where`, so the reminders of the type are loaded with the server and checked here.
 */

/** `include` fragment: the server's reminders of `type`, enough to tell their cycle. */
export function remindersOfType(type: EmailType) {
  return {
    where: { type },
    select: { expiresAt: true },
  } satisfies Prisma.GameServer$EmailArgs;
}

/** True when one of `reminders` was sent for the cycle that ends at `cycleDate`. */
export function reminderSentForCycle(
  reminders: { expiresAt: Date | null }[],
  cycleDate: Date,
): boolean {
  return reminders.some(
    (reminder) => reminder.expiresAt?.getTime() === cycleDate.getTime(),
  );
}
