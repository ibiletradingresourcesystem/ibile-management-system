import { getTokenFromRequest, verifyToken } from './jwt';
import { isBasicStaffRole } from './permission-utils';
import { canCallApi } from './apiAccess';
import { currentAccess } from './userAccess';

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

/** Answers the request and returns true: `res.json()` itself returns nothing a caller could test. */
function reject(res, status, error) {
  res.status(status).json({ error });
  return true;
}

/**
 * Signs the request in and checks it against lib/apiAccess.js. Returns true when it has refused
 * the request (the response is sent; the route must stop), null when the route may carry on.
 */
export function authMiddleware(req, res) {
  const token = getTokenFromRequest(req);

  if (!token) {
    return reject(res, 401, 'Missing authentication token');
  }

  const decoded = verifyToken(token);

  if (!decoded) {
    return reject(res, 401, 'Invalid or expired token');
  }

  const current = currentAccess(decoded);
  if (current && !current.isActive) {
    return reject(res, 401, 'Account is unavailable');
  }

  req.user = current ? { ...decoded, role: current.role, permissions: current.permissions } : decoded;

  if (!canCallApi(req.user, req.method, req.url)) {
    return reject(res, 403, 'Insufficient permissions');
  }

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
      return reject(res, 403, 'Insufficient permissions');
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

/** The plain staff role (or a viewer): see BASIC_STAFF_ROLES in lib/permission-utils.js. */
export function isBasicStaff(req) {
  return Boolean(req.user) && isBasicStaffRole(req.user.role);
}

export function isStaff(req) {
  return req.user && req.user.role !== ROLES.VIEWER;
}
