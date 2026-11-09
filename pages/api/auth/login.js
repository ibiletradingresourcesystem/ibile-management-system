import { createToken } from '@/lib/jwt';
import User from '@/models/User';
import bcrypt from 'bcryptjs';
import { isValidObjectId } from 'mongoose';
import { connectToDatabase } from '@/lib/mongodb';
import { normalizePermissions } from '@/lib/permission-utils';
import { LOCKED_MESSAGE, clearFailedLogins, isLockedOut, recordFailedLogin } from '@/lib/loginAttempts';

/** The account being signed in to: picked from the keypad's list (id), or typed (email). */
async function findUser({ userId, email }) {
  if (typeof userId === 'string') {
    return isValidObjectId(userId) ? User.findById(userId) : null;
  }
  // A string only: an object here would be run as a database query
  if (typeof email !== 'string') return null;
  const typed = email.trim();
  return User.findOne({ email: { $in: [typed, typed.toLowerCase()] } });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { userId, email, password } = req.body || {};

    if ((!email && !userId) || typeof password !== 'string' || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    await connectToDatabase();

    const user = await findUser({ userId, email });

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const account = `user:${user._id}`;

    if (await isLockedOut(account, req)) {
      return res.status(429).json({ error: LOCKED_MESSAGE });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      await recordFailedLogin(account, req);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (!user.isActive) {
      await recordFailedLogin(account, req);
      return res.status(401).json({ error: 'Account is inactive' });
    }

    await clearFailedLogins(account, req);

    const token = createToken(
      {
        id: user._id.toString(),
        email: user.email,
        name: user.name,
        role: user.role,
        permissions: normalizePermissions(user.permissions || []),
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
