# Expo App - API Configuration

This app calls the Next.js server (instead of local mocks). Configure which server to use via the following public environment variables (embedded at build time):

- EXPO_PUBLIC_API_ENV: one of `local` | `dev` | `prod`
- EXPO_PUBLIC_API_BASE_URL: full base URL (overrides EXPO_PUBLIC_API_ENV if set)

Defaults when nothing is set: `local` → `http://localhost:3000`.

## How base URL is chosen

1) If `EXPO_PUBLIC_API_BASE_URL` is set, its value is used (trailing slash removed)
2) Else, `EXPO_PUBLIC_API_ENV` is mapped to:
   - `local` → `http://localhost:3000`
   - `dev` → `https://conradscrossword.dev`
   - `prod` → `https://conradscrossword.com`

The helper used by the app is `withBaseUrl(path)` in `constants/Api.ts`.

## Local development

- iOS/Android simulator: you can usually use `http://localhost:3000`.
- Physical device: `localhost` points to the device itself. Set the base URL to your machine's LAN IP.

Examples:

```bash
# Simulator, use dev environment
EXPO_PUBLIC_API_ENV=dev npx expo start

# Simulator, use prod
EXPO_PUBLIC_API_ENV=prod npx expo start

# Physical device, point to your machine's IP
EXPO_PUBLIC_API_BASE_URL=http://192.168.1.42:3000 npx expo start
```

Note: Variables with the `EXPO_PUBLIC_` prefix are compiled into the app bundle. Do not place secrets in these.

## EAS Build/Run

In `eas.json`, set env per profile so builds target the right backend:

```json
{
  "build": {
    "development": {
      "env": { "EXPO_PUBLIC_API_ENV": "dev" }
    },
    "production": {
      "env": { "EXPO_PUBLIC_API_ENV": "prod" }
    }
  }
}
```

Or use `EXPO_PUBLIC_API_BASE_URL` to hardcode a specific server.

## Endpoints used

The app calls the following Next.js routes (all prefixed with the configured base URL):
- POST `/api/auth/otp/send`
- POST `/api/auth/login`
- POST `/api/auth/logout`
- GET `/api/profile`
- PATCH `/api/profile`
- GET `/api/puzzles/daily`
- GET `/api/puzzles/daily/complete`
- POST `/api/puzzles/daily/complete` (body: `{ timeMs: number }`)
- GET `/api/puzzles/daily/leaderboard`
- GET `/api/users/search?prefix=...`
- GET `/api/friends/requests`
- POST `/api/friends/requests/send` (body: `{ username: string }`)
- POST `/api/friends/requests/respond` (body: `{ action: 'accept'|'reject', username: string }`)

## Troubleshooting

- If requests fail on a physical device, verify the device can reach your machine's IP and that `EXPO_PUBLIC_API_BASE_URL` is set to that IP.
- Ensure the Next.js server is running and accessible at the chosen URL.

# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
