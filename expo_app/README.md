# API Configuration

This react-native app connects to a Next.js server on the backend. Which backend (local, dev, prod) is determined by EXPO_PUBLIC_API_ENV. There's no need to set this env variable manually, just use the following provided scripts:

## Expo Go development

Run `npm run start` to start an Expo Go server that points to the backend running at `http:localhost:3000`. See the `nextjs` directory for how to run this locally. This is a good setup for testing with simulators.

Run `npm run start:dev` to start an Expo Go server that points to the backend running at `https://conradscrossword.dev`. This is a good setup for testing with real devices. 

Prod backend is not intended to be useed with Expo Go - instead create a release app with Xcode / Android studio.

## Releases to iOS

First update the version in `app.json`. Then run `npx expo prebuild -p ios` to link the latest version of the expo project with xcode. Open `ios/xcworkspace` in XCode.

In the Apple Developer Console, create a new signing cert (download it) and associated profile (use "distribution to ios"). Then double click the cert to connect it to your keychain. Then in XCode, under the build settings, select that cert and profile. Then open `Info` in the file navigator, and add one to the bundle version. Finally click product->archive to create the archive. Once completed, it should open a popup, then click "distribute to app store connect". Wait a few minutes, then open up test flight and download the app. Proceed to test it.

### Debugging in Xcode

This shouldn't often be necessary, but if something isn't working on TestFlight, but it is working in Expo Go (connected to the dev backend), you can test in Xcode by simply connecting a simulator to the project and clicking `Product->Run`. If see "development mode", just do `Product->Schema->Edit Scheme` and select `release` mode.

## Release to Android

Run `npx expo prebuild -p android`, then `cd android`, then `open -a "Android Studio"` to open Android Studio.

### Setting an upload key

Generate an upload key with `keytool -genkeypair -v -keystore my-upload-key.keystore -alias my-key-alias -keyalg RSA -keysize 2048 -validity 10000` and set a password. Save a copy of the key and password somewhere safe. Then put `my-upload-key.keystore` in `expo_app/android/app` and create a .env file in the `expo_app/android` directory with `CROSSWORD_UPLOAD_KEY_PASSWORD` defined, so that `gradle.properties` can find it.

Also, to make the debug key, just do `keytool -genkey -v -keystore debug.keystore -storepass android -alias androiddebugkey -keypass android -keyalg RSA -keysize 2048 -validity 10000`. Probably not necessary if you only run in release mode (see below).

### Running on a simulator

`Build->Select Build Variant` and choose release. The just press run.

FYI: I was encountering an error `Installed Build Tools revision 36.0.0 is corrupted`, which ended up requiring manually removing the offending directory, "uninstalling" it with the SDK Manager, and then reinstalling.

### Generating signed app bundle

Select `Build -> Generate Signed App Bundle`, then follow steps.