import { getTokenFromRequest, verifyToken } from './jwt';

// Role-based access levels
export const ROLES = {
  ADMIN: 'admin',
  MANAGER: 'manager',
  STAFF: 'staff',
  VIEWER: 'viewer',
};

// Role hierarchy (higher number = more access)
const ROLE_LEVELS = {
  [ROLES.ADMIN]: 4,
  [ROLES.MANAGER]: 3,
  [ROLES.STAFF]: 2,
  [ROLES.VIEWER]: 1,
};

export function authMiddleware(req, res) {
  const token = getTokenFromRequest(req);

  if (!token) {
    return res.status(401).json({ error: 'Missing authentication token' });
  }

  const decoded = verifyToken(token);

  if (!decoded) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  req.user = decoded;
  return null; // No error
}

export function requireRole(...roles) {
  return (req, res) => {
    const error = authMiddleware(req, res);
    if (error) return error;

    const userRole = req.user.role;
    const userLevel = ROLE_LEVELS[userRole] || 0;
    const requiredLevel = Math.max(...roles.map(r => ROLE_LEVELS[r] || 0));

    if (userLevel < requiredLevel) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    return null; // No error
  };
}

export function isAdmin(req) {
  return req.user && req.user.role === ROLES.ADMIN;
}

export function isManager(req) {
  return req.user && (req.user.role === ROLES.ADMIN || req.user.role === ROLES.MANAGER);
}

export function isStaff(req) {
  return req.user && req.user.role !== ROLES.VIEWER;
}
