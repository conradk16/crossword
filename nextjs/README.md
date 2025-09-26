## Developing

To run the development server:

```bash
npm run dev
```

Serves locally at [http://localhost:3000](http://localhost:3000)

## Pages

Just a home a page, a privacy policy page, and a support page

## APIs

This app uses the nextjs app router. See the different routes in /app/api

## Database

On startup, Atlas automatically runs and applies updates to the postgres database.
See `package.json` scripts for the local Atlas apply code, and `entrypoint.sh` for the deployment Atlas apply code.
Schema is defined in `db/schema.pg.hcl`.

## Deployment

To deploy the database locally, use Docker Desktop and the `docker-compose-local.yml` at the root of the monorepo.
To deploy in dev/prod, see `deploy/README.md`, also from the root of the monorepo.
