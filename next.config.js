/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: {
    // ESLint 9 (flat config) is incompatible with Next.js's internal lint runner.
    // Run linting separately with `npm run lint` instead.
    ignoreDuringBuilds: true,
  },
};

module.exports = nextConfig;
