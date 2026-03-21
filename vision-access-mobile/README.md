# Luma Lane

Luma Lane is a cross-platform mobile app scaffold that combines the three desktop accessibility prototypes in this repository into one iOS/Android experience:

- `lol.py` -> live color assist
- `glare_reducer.py` -> night glare reduction
- `roadsign_webcam_alert.py` -> spoken road-sign guidance

## What is included

- Expo/React Native app structure for iOS and Android
- VisionCamera live camera pipeline
- Skia-powered realtime preview filters for color assist and glare reduction
- On-device road-sign detection screen wired for TensorFlow Lite
- Mobile export script that converts `best.pt` into app assets and writes the matching metadata manifest
- Accessibility-focused UI that avoids red/green-driven navigation cues

## Important note about the road-sign model

The app is scaffolded so it can ship with a bundled mobile model, but the current repository only contains `best.pt`. Mobile runtimes cannot use that file directly. You need to export it to TensorFlow Lite and copy it into `assets/models/roadsign.tflite`.

Use:

```powershell
python scripts/export_roadsign_model.py --weights ..\best.pt
```

That script writes:

- `assets/models/roadsign.tflite`
- `assets/models/roadsign_model.json`

## Local setup

Expo SDK 55 uses React Native 0.83 and Node 20.19+.

```powershell
cd vision-access-mobile
npm install
npx expo prebuild
npx expo run:android
```

For iOS on macOS:

```bash
cd vision-access-mobile
npm install
npx expo prebuild
npx expo run:ios
```

Because VisionCamera and TFLite use native code, this app requires a development build, not Expo Go.

## Store build flow

```powershell
cd vision-access-mobile
npm install
npx expo prebuild
eas build --platform android
eas build --platform ios
```

## Design direction

- Deep navy and slate base
- Cyan and amber highlights
- Large tap targets and strong contrast
- No red/green-only UI signaling
