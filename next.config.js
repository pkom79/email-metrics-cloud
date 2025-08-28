/** @type {import('next').NextConfig} */
const nextConfig = {
    experimental: {
        serverActions: {
            bodySizeLimit: '50mb'
        }
    },
    // Skip lint errors during production build so deployment isn't blocked.
    eslint: {
        ignoreDuringBuilds: true
    }
};

module.exports = nextConfig;
