How to get initial certificates

Set cloudflare config to flexible

Install docker compose if necessary:

sudo mkdir -p /usr/local/lib/docker/cli-plugins
sudo curl -SL "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/lib/docker/cli-plugins/docker-compose
sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

Then:
`docker compose down nginx`
`docker compose --profile nginx_certbot_init up -d`
`docker run --rm -v letsencrypt:/etc/letsencrypt -v webroot:/var/www/certbot certbot/certbot certonly --webroot -w /var/www/certbot -d conradscrossword.<dev/com> -d www.conradscrossword.<dev/com> --email conradkuklinsky@gmail.com --agree-tos --no-eff-email`
Should see something like:
>Certificate is saved at: /etc/letsencrypt/live/conradscrossword.dev/fullchain.pem
Key is saved at:         /etc/letsencrypt/live/conradscrossword.dev/privkey.pem

Update nginx/nginx.conf.template with the right path

docker compose stop nginx_certbot_init

set cloudflare config to strict

deploy normally

