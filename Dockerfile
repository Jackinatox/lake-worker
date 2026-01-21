FROM oven/bun:1 AS base

# Set the working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json to the working directory
# FROM base AS deps
COPY package*.json bun.lock ./
RUN bun install --no-save --frozen-lockfile

# Copy the rest of the application files
# FROM base AS builder
# WORKDIR /app
# COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun prisma generate

# Build the NestJS application
RUN bun run build

# FROM oven/bun:1 AS runner
# WORKDIR /app

# COPY --from=base --chown=bun:bun /app/node_modules ./dist/node_modules
# COPY --from=base --chown=bun:bun  /app/dist ./dist

ENV NODE_ENV=production

# Expose the application port
EXPOSE 3000

# Command to run the application
CMD ["bun", "dist/src/main"]