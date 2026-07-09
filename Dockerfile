FROM node:20-alpine

# Нативные зависимости для bcrypt и sharp
RUN apk add --no-cache python3 make g++ vips-dev

WORKDIR /app

# Копируем манифесты зависимостей первыми для кэширования слоя
COPY package.json package-lock.json ./

# Устанавливаем production-зависимости строго по lockfile и проверяем критичные runtime imports
RUN npm ci --omit=dev \
  && node -e "require('express'); require('bcrypt'); require('bcryptjs'); require('sharp')"

# Копируем весь проект
COPY . .

# Railway подставит PORT автоматически
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null || exit 1

CMD ["node", "--max-old-space-size=512", "server/gateway/apiGateway.js"]
