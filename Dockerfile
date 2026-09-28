# ---------- build stage: compile TypeScript ----------
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---------- runtime stage: production deps + compiled JS only ----------
FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist

# Cloud Run injects PORT (8080); src/config/env.ts already reads it.
# Document uploads go to /app/uploads/documents — on Cloud Run that path is
# backed by a Cloud Storage bucket volume so files survive instance restarts.
EXPOSE 8080
CMD ["node", "dist/server.js"]
