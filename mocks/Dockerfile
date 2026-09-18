FROM node:24-slim
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY mocks/package.json mocks/
RUN pnpm install --frozen-lockfile --filter mocks
COPY mocks mocks
RUN pnpm --filter mocks build
EXPOSE 9999
CMD ["node", "mocks/dist/main.js"]
