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
RUN apk add --no-cache aws-cli jq curl && \
    set -o pipefail && \
    curl -sSf https://atlasgo.sh | sh -s -- -b /usr/local/bin && \
    echo "Atlas installation complete. Verifying..." && \
    atlas version

WORKDIR /app

# Drop root: run as the unprivileged 'node' user shipped with node:20-alpine.
# Own the (empty) workdir as node, then write every file as node via --chown so
# the app can manage its runtime cache (.next/cache) WITHOUT a recursive `chown -R`
# at the end (which would duplicate all of /app into an extra layer, ~doubling it).
# Running non-root limits the blast radius of any future app-level RCE.
RUN chown node:node /app
USER node

# Copy Atlas schema file and the entrypoint script
COPY --chown=node:node db/schema.pg.hcl /app/db/schema.pg.hcl
COPY --chown=node:node entrypoint.sh /app/entrypoint.sh

RUN chmod +x /app/entrypoint.sh

COPY --chown=node:node package.json ./
COPY --chown=node:node package-lock.json ./

RUN npm install --production

COPY --chown=node:node --from=builder /app/.next ./.next
COPY --chown=node:node --from=builder /app/public ./public
COPY --chown=node:node --from=builder /app/src/lib/usernameDisallowList.txt ./src/lib/usernameDisallowList.txt

EXPOSE 3000

ENTRYPOINT ["/app/entrypoint.sh"]

CMD ["npm", "start"]
