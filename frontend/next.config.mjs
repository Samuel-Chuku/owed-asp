/** @type {import('next').NextConfig} */
const nextConfig = {
  // frontend/ is its own app inside the backend repo; pin the tracing root so
  // Next stops guessing between the two lockfiles.
  outputFileTracingRoot: import.meta.dirname,
};

export default nextConfig;
