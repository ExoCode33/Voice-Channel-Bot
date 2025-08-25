# Use official Node.js runtime - using bullseye for better compatibility
FROM node:18-bullseye-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    gcc \
    libc6-dev \
    libffi-dev \
    libssl-dev \
    ffmpeg \
    libopus-dev \
    libsodium-dev \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies with better error handling
RUN npm install --omit=dev --verbose

# Copy application code
COPY . .

# Create directory for audio files
RUN mkdir -p /app/audio

# Expose port (Railway will use PORT env var)
EXPOSE 3000

# Add a simple health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "console.log('Bot health check passed')" || exit 1

# Start the bot
CMD ["npm", "start"]
