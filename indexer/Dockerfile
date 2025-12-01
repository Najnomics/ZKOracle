FROM node:20-slim

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install

COPY src ./src
COPY tsconfig.json ./

CMD ["pnpm", "start"]

