#!/bin/sh
set -e

# --- Configuration ---
DB_SECRET_NAME="crossword-postgres"

# Read the region from the environment variable
: "${AWS_REGION:?AWS_REGION environment variable not set or empty}"

echo "Fetching database credentials from AWS Secrets Manager in region: ${AWS_REGION}..."

# Fetch the secret from AWS and parse it with jq
DB_SECRET_JSON=$(aws secretsmanager get-secret-value --secret-id "${DB_SECRET_NAME}" --region "${AWS_REGION}" --query SecretString --output text)
DB_USER=$(echo "${DB_SECRET_JSON}" | jq -r .username)
DB_PASSWORD=$(echo "${DB_SECRET_JSON}" | jq -r .password)
DB_HOST=$(echo "${DB_SECRET_JSON}" | jq -r .host)
DB_PORT=$(echo "${DB_SECRET_JSON}" | jq -r .port)
DB_NAME=$(echo "${DB_SECRET_JSON}" | jq -r .database)

# Construct and export the DATABASE_URL
export DATABASE_URL="postgres://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}?sslmode=disable"

echo "Fetching Resend API key from AWS Secrets Manager..."
RESEND_SECRET_NAME="resend_api_key"
RESEND_SECRET_JSON=$(aws secretsmanager get-secret-value --secret-id "${RESEND_SECRET_NAME}" --region "${AWS_REGION}" --query SecretString --output text)
RESEND_KEY_VALUE=$(echo "${RESEND_SECRET_JSON}" | jq -r .key)
export RESEND_KEY="${RESEND_KEY_VALUE}"

echo "Waiting for database to be ready..."
until atlas schema apply -u "$DATABASE_URL" -f file:///app/db/schema.pg.hcl --dry-run; do
  >&2 echo "Postgres is unavailable - sleeping"
  sleep 1
done
echo "Database is ready."

echo "Applying database schema..."
atlas schema apply \
  -u "$DATABASE_URL" \
  -f file:///app/db/schema.pg.hcl \
  --auto-approve

echo "Schema is up to date."

exec "$@"