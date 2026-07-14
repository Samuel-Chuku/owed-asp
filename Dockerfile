# Owed ASP — production image. Runtime is just tsx over src/ (no build step);
# Playwright and test tooling are devDependencies and never enter the image.
FROM node:20-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY tsconfig.json ./
COPY src ./src

# data/ (cache, snapshots, jobs, scans) is a volume — state survives redeploys
VOLUME /app/data

EXPOSE 8402
CMD ["node_modules/.bin/tsx", "src/server/index.ts"]
