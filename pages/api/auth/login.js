import { createToken } from '@/lib/jwt';
import User from '@/models/User';
import bcrypt from 'bcryptjs';
import { connectToDatabase } from '@/lib/mongodb';
import { normalizePermissions } from '@/lib/permission-utils';

const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;
const loginAttempts = new Map();

function getAttemptKey(req, email = "") {
  const ip =
    req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    "unknown-ip";
  return `${String(email).toLowerCase()}::${ip}`;
}

function registerFailure(key) {
  const now = Date.now();
  const entry = loginAttempts.get(key) || { count: 0, firstAttemptAt: now };
  if (now - entry.firstAttemptAt > LOGIN_WINDOW_MS) {
    entry.count = 0;
    entry.firstAttemptAt = now;
  }
  entry.count += 1;
  loginAttempts.set(key, entry);
  return entry;
}

function clearFailure(key) {
  loginAttempts.delete(key);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const attemptKey = getAttemptKey(req, email);
    const currentEntry = loginAttempts.get(attemptKey);
    if (
      currentEntry &&
      currentEntry.count >= MAX_FAILED_ATTEMPTS &&
      Date.now() - currentEntry.firstAttemptAt <= LOGIN_WINDOW_MS
    ) {
      return res.status(429).json({
        error: "Too many failed login attempts. Please try again later.",
      });
    }

    await connectToDatabase();

    const user = await User.findOne({ email });

    if (!user) {
      registerFailure(attemptKey);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      registerFailure(attemptKey);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (!user.isActive) {
      registerFailure(attemptKey);
      return res.status(401).json({ error: 'Account is inactive' });
    }

    clearFailure(attemptKey);

    const token = createToken(
      {
        id: user._id.toString(),
        email: user.email,
        name: user.name,
        role: user.role,
      },
      '24h'
    );

    return res.status(200).json({
      token,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role,
        permissions: normalizePermissions(user.permissions || []),
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Login failed' });
  }
}
