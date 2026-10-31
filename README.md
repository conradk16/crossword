# crossword
A daily crossword app with leaderboard

## Structure
There are three main apps in separate directories: `expo_app`, `nextjs`, and `nginx`. Each directoy has it's own `README.md`, so please refer to those. `nextjs` and `nginx` are deployed to ec2 via a script in the `deploy` directory. (This directory also has its own `README.md`). `expo_app`, on the other hand, is linked to Xcode and Android studio for app-platform-specific releases.
