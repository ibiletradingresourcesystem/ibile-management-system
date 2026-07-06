import { authMiddleware } from '@/lib/auth-middleware';

export default async function handler(req, res) {
  // Verify authentication
  const authError = authMiddleware(req, res);
  if (authError) return authError;

  // Now req.user contains: { id, email, name, role }
  const { user } = req;

  if (req.method === 'GET') {
    try {
      // Example: Get protected data
      return res.status(200).json({
        message: 'This is a protected endpoint',
        user: user,
      });
    } catch (err) {
      console.error('Error:', err);
      return res.status(500).json({ error: 'Server error' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
