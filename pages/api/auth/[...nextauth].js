// This file has been replaced by JWT authentication
// Old NextAuth configuration is no longer used
// See /pages/api/auth/login.js and /pages/api/auth/register.js for new auth endpoints

export default function handler(req, res) {
  res.status(404).json({ 
    error: "NextAuth is no longer used. Use JWT authentication instead.",
    message: "Please use /api/auth/login or /api/auth/register"
  });
}
