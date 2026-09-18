FROM node:24-slim AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY agent/package.json agent/
RUN pnpm install --frozen-lockfile --filter agent
COPY agent agent
RUN pnpm --filter agent build

FROM node:24-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip curl jq ca-certificates \
  && pip3 install --break-system-packages --no-cache-dir pandas numpy requests vectorbt "plotly<6" \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY agent/package.json agent/
RUN pnpm install --frozen-lockfile --filter agent --prod --ignore-scripts \
  && rm -rf node_modules/.pnpm/*linux-x64-musl* \
  && rm -rf /root/.cache /root/.local/share/pnpm/store
COPY agent agent
COPY --from=build /app/agent/dist agent/dist
EXPOSE 8080
CMD ["node", "agent/dist/main.js"]
