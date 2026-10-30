# syntax=docker/dockerfile:1

# ---- Production dependencies ----
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi \
 && npm cache clean --force

# ---- Runtime image ----
FROM node:24-alpine
ENV NODE_ENV=production \
    PORT=8080
WORKDIR /app
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src

# Never run the app as root inside the container.
USER node
EXPOSE 8080

# docker-compose on the server defines its own healthcheck; this one helps when running the image directly.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health',r=>process.exit(r.statusCode<400?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "src/server.js"]
