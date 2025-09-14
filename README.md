# crossword
A daily crossword app with leaderboard

## Local development
- Use docker-compose-local.yml to start postgres on Docker Desktop
- Use `npm run dev` in the `nextjs` directory to start the nextjs app

# Testing Docker changes in dev without committing (avoid github actions):
- find the image name on dockerhub (e.g. conradkuklinsky/crossword-nextjs-dev:b0a5b3d)
- docker buildx build --no-cache --platform linux/amd64 \
-t conradkuklinsky/crossword-nextjs-dev:b0a5b3d --push .
- make sure to change the commit sha to something new