import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Native deps and large binaries that must NOT be bundled by Next:
  //  - pdf-parse, pdfjs-dist, canvas: PDF + OCR rasterisation pipeline
  //  - puppeteer-core, @sparticuz/chromium: PDF bundle rendering
  //  - @aws-sdk/client-textract: large SDK, leave external
  serverExternalPackages: [
    'pdf-parse',
    'pdfjs-dist',
    'canvas',
    'puppeteer-core',
    '@sparticuz/chromium',
    '@aws-sdk/client-textract',
  ],
  experimental: {
    serverActions: {
      bodySizeLimit: '50mb',
    },
  },
};

export default nextConfig;
