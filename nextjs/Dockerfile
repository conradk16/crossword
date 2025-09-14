FROM node:20-alpine AS builder

WORKDIR /app

# Copy package.json and package-lock.json first to leverage Docker's layer caching.
# This way, 'npm install' only runs again if these files change.
COPY package.json ./
COPY package-lock.json ./
RUN npm install

COPY . .

RUN npm run build

FROM node:20-alpine

ARG AWS_REGION

# Make aws region available to entrypoint.sh
ENV AWS_REGION=${AWS_REGION}

# Install AWS CLI, jq, and Atlas
RUN apk add --no-cache aws-cli jq
RUN curl -sSf https://atlasgo.sh | sh -s -- -b /usr/local/bin

WORKDIR /app

# Copy Atlas schema file and the entrypoint script
COPY db/schema.pg.hcl /app/db/schema.pg.hcl
COPY entrypoint.sh /app/entrypoint.sh

RUN chmod +x /app/entrypoint.sh

COPY package.json ./
COPY package-lock.json ./

RUN npm install --production

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public

EXPOSE 3000

ENTRYPOINT ["/app/entrypoint.sh"]

CMD ["npm", "start"]
