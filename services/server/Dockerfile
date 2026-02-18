FROM node:20-alpine AS base
WORKDIR /app

# Install all workspace deps
COPY package.json ./
COPY apps/web/package.json ./apps/web/
COPY services/server/package.json ./services/server/
RUN npm install --workspaces

# Build web app
COPY apps/web ./apps/web
RUN npm run build -w @breadcrumb/web

# Build server
COPY services/server ./services/server
RUN npm run build -w @breadcrumb/server

# Production image
FROM base AS runner
ENV NODE_ENV=production
COPY --from=0 /app/services/server/dist ./dist
COPY --from=0 /app/services/server/node_modules ./node_modules
COPY --from=0 /app/services/server/package.json ./
COPY --from=0 /app/apps/web/dist ./public
EXPOSE 3100
CMD ["node", "dist/index.js"]
