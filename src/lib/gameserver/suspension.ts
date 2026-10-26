import { Prisma } from 'src/generated/prisma/client';

/**
 * A gameserver is suspended (quarantined by an admin) while a `GameServerSuspension` row
 * satisfies `liftedAt IS NULL AND expiresAt > now()`. The suspension deliberately lives
 * next to `GameServer.status` instead of inside it, because it is orthogonal to the
 * lifecycle: a server can be suspended while ACTIVE *or* while EXPIRED.
 *
 * These are functions, not consts — a module-level `new Date()` would freeze at import
 * time and every later comparison would be made against the moment the worker booted.
 */

/** `where` on GameServerSuspension: the one suspension that is currently in force. */
export function activeSuspensionWhere(
  now: Date = new Date(),
): Prisma.GameServerSuspensionWhereInput {
  return { liftedAt: null, expiresAt: { gt: now } };
}

/**
 * `where` on GameServerSuspension: suspensions whose end date has passed and that nobody
 * has lifted yet — exactly the rows ProcessSuspensions has to act on.
 */
export function expiredSuspensionWhere(
  now: Date = new Date(),
): Prisma.GameServerSuspensionWhereInput {
  return { liftedAt: null, expiresAt: { lte: now } };
}

/**
 * `where` fragment on GameServer: everything that is *not* currently suspended.
 *
 * Spread into every scheduled job that touches servers. A suspended server must not be
 * expired, deleted or mailed about by the lifecycle jobs — ProcessSuspensions owns it
 * until the suspension is over, and an unrelated job unsuspending it in Pterodactyl would
 * hand a quarantined server straight back to its owner.
 */
export function notSuspendedWhere(
  now: Date = new Date(),
): Prisma.GameServerWhereInput {
  return { suspensions: { none: activeSuspensionWhere(now) } };
}
