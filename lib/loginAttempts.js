/**
 * Limits wrong PINs, because a 4-digit PIN has only 10,000 possibilities.
 *
 * Kept in the database, not in memory: each server instance had its own count, so the limit could
 * be walked around. It only runs on sign-in, and a locked account skips the PIN check, which is the
 * expensive part. The counts are per account from one address, so someone guessing cannot lock the
 * real person out from elsewhere, and per account overall, so spreading guesses across addresses
 * does not help either. The till uses the same collection and limits (its src/lib/loginAttempts.js).
 */
import LoginAttempt from "@/models/LoginAttempt";

const WINDOW_MS = 30 * 60 * 1000;
const MAX_FROM_ONE_ADDRESS = 5;
const MAX_FOR_ACCOUNT = 20;

export const LOCKED_MESSAGE = "Too many wrong attempts. Please try again in 30 minutes.";

function clientAddress(req) {
  return req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() || req.socket?.remoteAddress || "unknown";
}

const accountKey = (account) => `account:${account}`;
const addressKey = (account, req) => `address:${account}:${clientAddress(req)}`;

export async function isLockedOut(account, req) {
  const byAddress = addressKey(account, req);
  const rows = await LoginAttempt.find({
    _id: { $in: [accountKey(account), byAddress] },
    expiresAt: { $gt: new Date() },
  }).lean();
  return rows.some((row) => row.count >= (row._id === byAddress ? MAX_FROM_ONE_ADDRESS : MAX_FOR_ACCOUNT));
}

export async function recordFailedLogin(account, req) {
  const expiresAt = new Date(Date.now() + WINDOW_MS);
  await LoginAttempt.bulkWrite(
    [accountKey(account), addressKey(account, req)].map((_id) => ({
      updateOne: { filter: { _id }, update: { $inc: { count: 1 }, $setOnInsert: { expiresAt } }, upsert: true },
    }))
  );
}

/** After a correct PIN. The account's overall count stays, or a guesser could clear it by proxy. */
export async function clearFailedLogins(account, req) {
  await LoginAttempt.deleteOne({ _id: addressKey(account, req) });
}
