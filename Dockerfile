# Use official Node.js runtime as base image
FROM node:18-alpine

# Install system dependencies for audio processing
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    ffmpeg \
    opus

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --omit=dev

# Copy application code
COPY . .

# Create directory for audio files
RUN mkdir -p /app/audio

# Expose port (Railway will use PORT env var)
EXPOSE 3000

# Health check endpoint (optional)
RUN echo "console.log('Health check: Bot is running');" > health.js

# Start the bot
CMD ["npm", "start"]
