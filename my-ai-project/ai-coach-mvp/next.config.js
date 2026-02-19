/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: '/browser/:path*',
        destination: 'http://localhost:9980/browser/:path*',
      },
    ];
  },
};

module.exports = nextConfig;
