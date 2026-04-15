FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# Copy prisma schema and generate client
COPY prisma ./prisma
RUN bunx prisma generate

# Copy source code
COPY . .

# Expose port
EXPOSE 3001

# Start the server with migrations
CMD ["sh", "-c", "bunx prisma migrate deploy && bun src/index.ts"]
