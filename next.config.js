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
    },
    // Increase API route body size limit for large CSV uploads
    api: {
        bodyParser: {
            sizeLimit: '50mb',
        },
    }
};

module.exports = nextConfig;
