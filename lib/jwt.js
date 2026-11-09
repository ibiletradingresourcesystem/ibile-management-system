import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET;

export function createToken(payload, expiresIn = '24h') {
  if (!JWT_SECRET) {
    throw new Error("JWT_SECRET is not configured");
  }
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
}

function decodeToken(token) {
  if (!JWT_SECRET) return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}

/** A sign-in token for the app. A token made for one job (verifyScopedToken) is not one. */
export function verifyToken(token) {
  const decoded = decodeToken(token);
  return decoded && !decoded.scope ? decoded : null;
}

/** A token made for one job, such as counting one stock take on a phone. */
export function verifyScopedToken(token, scope) {
  const decoded = decodeToken(token);
  return decoded && decoded.scope === scope ? decoded : null;
}

export function getTokenFromRequest(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.substring(7);
}
