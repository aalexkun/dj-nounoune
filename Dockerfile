# Stage 1: Base image using Node 24 Alpine
FROM node:24-alpine AS base
WORKDIR /usr/src/app

# Stage 2: Builder (Requires dev tools to compile TypeScript)
FROM base AS builder
# Install build tools in case native dependencies need compiling
RUN apk add --no-cache python3 make g++
COPY package*.json ./

# Install ALL dependencies required for the build process
RUN npm ci

# Copy the source code and compile it
COPY . .
RUN npm run build

# Stage 3: Production Dependencies Builder
FROM base AS deps
# Install build tools for native dependencies
RUN apk add --no-cache python3 make g++
COPY package*.json ./
# Install ONLY production dependencies
RUN npm ci --omit=dev

# Stage 4: Pure Production Image
FROM base AS production
# Enforce production environment variables
ENV NODE_ENV=production

# Copy only the package files
COPY package*.json ./

# Copy the production node_modules from the deps stage
COPY --from=deps /usr/src/app/node_modules ./node_modules

# Copy the compiled javascript from the builder stage
COPY --from=builder --chown=node:node /usr/src/app/dist ./dist


# Switch to the secure, unprivileged node user
USER node

# Expose the application port
EXPOSE 3000

# Run the compiled application
CMD ["node", "dist/main"]