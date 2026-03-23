# Use Node.js LTS — same major version you developed with
FROM node:20-alpine

# Set working directory inside container
WORKDIR /app

# Copy package files first — Docker caches this layer
# If only source files change, npm install is NOT re-run (faster builds)
COPY package.json package-lock.json ./

# Install production dependencies only
# --omit=dev excludes devDependencies (nodemon etc.) from production image
RUN npm install --omit=dev

# Copy the rest of the server source
COPY . .

# Expose the port Railway will forward traffic to
# Railway automatically sets PORT env var — your server must use process.env.PORT
EXPOSE 3001

# Start the server
CMD ["node", "src/index.js"]
