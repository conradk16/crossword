# Use the official lightweight Nginx image
FROM nginx:alpine

# Install envsubst for placeholder replacement
RUN apk add --no-cache gettext

COPY nginx.conf.template /etc/nginx/conf.d/default.conf.template

ARG SERVER_NAME

# Replace placeholder with actual value
RUN SERVER_NAME=$SERVER_NAME envsubst '${SERVER_NAME}' \
    < /etc/nginx/conf.d/default.conf.template \
    > /etc/nginx/conf.d/default.conf

# NGINX starts automatically with CMD from base image