FROM oven/bun:1 AS base

# Set the working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json to the working directory
# FROM base AS deps
COPY package*.json bun.lock ./
RUN bun install --no-save --frozen-lockfile

COPY . .
RUN bun prisma generate --config ./prisma.config.ts
RUN bun prisma generate --config ./prisma-pterodactyl/prisma.config.ts

# Build the NestJS application
RUN bun run build

ENV NODE_ENV=production

EXPOSE 3000

CMD ["bun", "dist/src/main"]