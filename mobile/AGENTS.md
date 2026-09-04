# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

Upgraded from SDK 54 to SDK 57 on 2026-09-04 (Expo Go on iOS only ever
supports the latest SDK, and a user's Expo Go auto-updated past 54). New
Architecture is now mandatory as of SDK 55 — there is no legacy-architecture
opt-out any more. expo-video-thumbnails was removed in SDK 56; its
replacement (VideoPlayer.generateThumbnailsAsync) returns an expo-image
SharedRef rather than a plain uri, which this app's plain react-native
<Image> can't consume directly — the recent-gallery-thumbnail feature in
SellScreen.tsx currently falls back to no-thumbnail for videos (photos are
unaffected) until that's properly redone against expo-image.
