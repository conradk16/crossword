#!/bin/sh
set -e

# --- Configuration ---
SECRET_NAME="crossword-postgres"
AWS_REGION="${1}"

echo "Fetching database credentials from AWS Secrets Manager..."

# Fetch the secret from AWS and parse it with jq
SECRET_JSON=$(aws secretsmanager get-secret-value --secret-id $SECRET_NAME --region $AWS_REGION --query SecretString --output text)
DB_USER=$(echo $SECRET_JSON | jq -r .username)
DB_PASSWORD=$(echo $SECRET_JSON | jq -r .password)
DB_HOST=$(echo $SECRET_JSON | jq -r .host)
DB_PORT=$(echo $SECRET_JSON | jq -r .port)
DB_NAME=$(echo $SECRET_JSON | jq -r .dbname)

# Construct and export the DATABASE_URL
export DATABASE_URL="postgres://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}?sslmode=disable"

echo "Waiting for database to be ready..."
until atlas schema apply -u "$DATABASE_URL" --dry-run > /dev/null 2>&1; do
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

# Shift the first argument (AWS_REGION) and execute the remaining command
shift
exec "$@"