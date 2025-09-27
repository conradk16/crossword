# API Configuration

This react-native app connects to a Next.js server on the backend. Which backend (local, dev, prod) is determined by EXPO_PUBLIC_API_ENV. There's no need to set this env variable manually, just use the following provided scripts:

## Expo Go development

Run `npm run start` to start an Expo Go server that points to the backend running at `http:localhost:3000`. See the `nextjs` directory for how to run this locally. This is a good setup for testing with simulators.

Run `npm run start:dev` to start an Expo Go server that points to the backend running at `https://conradscrossword.dev`. This is a good setup for testing with real devices. 

Prod backend is not intended to be useed with Expo Go - instead create a release app with Xcode / Android studio.

## Releases to iOS

Run `npx expo prebuild -p ios` to link the latest version of the expo project with xcode. Open `ios/xcworkspace` in XCode.

In the Apple Developer Console, create a new signing cert (download it) and associated profile (use "distribution to ios"). Then double click the cert to connect it to your keychain. Then in XCode, under the build settings, select that cert and profile. Finally click product->archive to create the archive. Once completed, it should open a popup, then click "distribute to app store connect". Wait a few minutes, then open up test flight and download the app. Proceed to test it.

### Debugging in Xcode

This shouldn't often be necessary, but if something isn't working on TestFlight, but it is working in Expo Go (connected to the dev backend), you can test in Xcode by simply connecting a simulator to the project and clicking `Product->Run`. If see "development mode", just do `Product->Schema->Edit Scheme` and select `release` mode.

## Release to Android

Todo