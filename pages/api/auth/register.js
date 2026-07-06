import User from '@/models/User';
import bcrypt from 'bcryptjs';
import { connectToDatabase } from '@/lib/mongodb';
import { getTokenFromRequest, verifyToken } from '@/lib/jwt';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email, password, name, role = 'staff' } = req.body;
    const normalizedEmail = String(email || "").trim().toLowerCase();

    if (!normalizedEmail || !password || !name) {
      return res.status(400).json({ error: 'Email, PIN, and name are required' });
    }

    // Validate PIN is 4 digits
    if (!/^\d{4}$/.test(password)) {
      return res.status(400).json({ error: 'PIN must be exactly 4 digits' });
    }

    await connectToDatabase();

    const totalUsers = await User.countDocuments({});
    const token = getTokenFromRequest(req);
    const requester = token ? verifyToken(token) : null;
    const requesterIsAdmin = requester?.role === 'admin';

    if (totalUsers > 0 && !requesterIsAdmin) {
      return res.status(403).json({
        error: 'Only an authenticated admin can create additional users',
      });
    }

    const allowedRoles = ['admin', 'sub-admin', 'inventory', 'account', 'manager', 'staff', 'viewer'];
    const requestedRole = allowedRoles.includes(role) ? role : 'staff';
    const safeRole = totalUsers === 0 ? 'admin' : requestedRole;

    const existingUser = await User.findOne({ email: normalizedEmail });

    if (existingUser) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // First user gets all permissions. Others get role-based defaults.
    let permissions = [];
    if (totalUsers === 0 || safeRole === 'admin') {
      permissions = ['setup', 'manage', 'stock', 'reporting', 'expenses', 'support', 'staff', 'assets', 'users'];
    }

      const user = await User.create({
      email: normalizedEmail,
      password: hashedPassword,
      name,
      role: safeRole,
      permissions,
      isActive: true,
    });

    return res.status(201).json({
      success: true,
      message: 'User registered successfully',
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });
  } catch (err) {
    console.error('Registration error:', err);
    return res.status(500).json({ error: 'Registration failed' });
  }
}
