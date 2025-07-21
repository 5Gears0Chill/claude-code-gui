/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  assetPrefix: process.env.NODE_ENV === 'production' ? undefined : '',
  webpack: (config) => {
    config.externals.push('fs', 'net', 'tls');
    return config;
  },
};

module.exports = nextConfig;