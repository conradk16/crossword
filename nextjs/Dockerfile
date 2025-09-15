# intended to be run from monorepo root

FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json ./
COPY nextjs/package.json ./nextjs/

RUN npm install --workspace=nextjs

COPY nextjs/ ./nextjs/
COPY tsconfig.json ./

RUN npm run build --workspace=nextjs

#  Final Stage
FROM node:20-alpine

ARG AWS_REGION
ENV AWS_REGION=${AWS_REGION}

# Install dependencies
RUN apk add --no-cache aws-cli jq curl && \
    set -o pipefail && \
    curl -sSf https://atlasgo.sh | sh -s -- -b /usr/local/bin && \
    atlas version

WORKDIR /app

COPY nextjs/db/schema.pg.hcl /app/db/schema.pg.hcl
COPY nextjs/entrypoint.sh /app/entrypoint.sh

RUN chmod +x /app/entrypoint.sh

COPY package.json ./
COPY nextjs/package.json ./nextjs/

RUN npm install --workspace=nextjs --only=production

COPY --from=builder /app/nextjs/.next ./nextjs/.next
COPY --from=builder /app/nextjs/public ./nextjs/public

EXPOSE 3000

ENTRYPOINT ["/app/entrypoint.sh"]

CMD ["npm", "start", "--workspace=nextjs"]