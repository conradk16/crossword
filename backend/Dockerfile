# 1. Base Image: Use the official Node.js image.
# The `alpine` version is a lightweight Linux distribution.
FROM node:18-alpine AS base

# 2. Builder Stage: This stage will install dependencies and build the app.
FROM base AS builder
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Build the Next.js application for production
RUN npm run build

# 3. Production Stage: This is the final, lightweight image that will run the app.
FROM base AS runner
WORKDIR /app

# Set environment variable to production
ENV NODE_ENV=production

# Copy the built application from the 'builder' stage
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# Expose the port the app runs on
EXPOSE 3000

# The command to start the app
CMD ["npm", "start"]