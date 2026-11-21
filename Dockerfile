FROM node:20-alpine

WORKDIR /app

# Install dependencies untuk Baileys (python, build tools)
RUN apk add --no-cache python3 make g++ sqlite

# Copy package files
COPY package*.json ./

# Install deps
RUN npm ci --only=production

# Copy source
COPY . .

# Create auth directory (persistent volume akan mount di sini)
RUN mkdir -p /app/auth

# Expose port (fly.io butuh port untuk health check)
EXPOSE 8080

# Health check endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/health', (r) => {if(r.statusCode!==200) process.exit(1)})" || exit 1

CMD ["node", "index.js"]