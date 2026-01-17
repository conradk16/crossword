# crossword
A daily crossword app with leaderboard

## Structure
There are three main apps in separate directories: `expo_app`, `nextjs`, and `nginx`. Each directoy has it's own `README.md`, so please refer to those. `nextjs` and `nginx` are deployed to ec2 via a script in the `deploy` directory. (This directory also has its own `README.md`). `expo_app`, on the other hand, is linked to Xcode and Android studio for app-platform-specific releases.

## Testing Docker changes in dev without committing (avoid github actions):
- find the image name on dockerhub (e.g. conradkuklinsky/crossword-nextjs-dev:b0a5b3d)
- docker buildx build --no-cache --platform linux/amd64 \
-t conradkuklinsky/crossword-nextjs-dev:b0a5b3d --push .
- make sure to change the commit sha to something new

## Notes
- removed dev tier in AWS, so prod's the only one that actually works.