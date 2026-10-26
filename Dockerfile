FROM node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=80

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.mjs ./
COPY lib ./lib
COPY public ./public
COPY seed ./seed

EXPOSE 80

CMD ["node", "server.mjs"]
