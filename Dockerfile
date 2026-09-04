# Stage 1: Base image using Node 26 Alpine
FROM node:26-alpine AS base
WORKDIR /usr/src/app

# Stage 2: Builder (Requires dev tools to compile TypeScript)
FROM base AS builder
# Install build tools in case native dependencies need compiling
RUN apk add --no-cache python3 make g++
# .npmrc carries the project policy (engine-strict, min-release-age); no secrets live in it.
COPY package*.json .npmrc ./

# Install ALL dependencies required for the build process.
# --ignore-scripts: nothing the build needs runs an install script (the only ones in the tree are
# no-ops or optional native rebuilds, see "allowScripts" in package.json), so skip them wholesale.
RUN npm ci --ignore-scripts

# Copy the source code and compile it (.dockerignore keeps .env, session tokens and node_modules out)
COPY . .
RUN npm run build

# Stage 3: Production Dependencies Builder
FROM base AS deps
# Install build tools for native dependencies
RUN apk add --no-cache python3 make g++
COPY package*.json .npmrc ./
# Install ONLY production dependencies, again without install scripts
RUN npm ci --omit=dev --ignore-scripts

# Stage 4: Pure Production Image
FROM base AS production
# Enforce production environment variables
ENV NODE_ENV=production
ARG APP_VERSION=unknown
ENV npm_package_version=${APP_VERSION}
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