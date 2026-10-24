#!/usr/bin/env bash
# Check 6b: Expo prebuild with expo-sqlite + SQLCipher compiles its native projects on the Linux runner; Yjs compiles under Hermes.
# Real-phone runtime (device SQLCipher open, 200k-row query, Hermes execution) is deferred until the owner connects phones.
W=$(mktemp -d /var/tmp/expo-spike.XXXXXX 2>/dev/null || mktemp -d); cd "$W" || exit 1
node -v; res() { echo "METRIC {\"name\":\"s6.expo.$1\",\"result\":\"$2\"}"; }
npx --yes create-expo-app@latest app --template blank --no-install >/dev/null 2>&1 && res create ok || { res create FAIL; exit 1; }
cd app
npm install --no-audit --no-fund --legacy-peer-deps >/dev/null 2>&1 && res npm_install ok || res npm_install FAIL
npx --yes expo install expo-sqlite >/dev/null 2>&1 && res expo_install_sqlite ok || { npm install expo-sqlite --legacy-peer-deps >/dev/null 2>&1 && res expo_install_sqlite ok_via_npm || res expo_install_sqlite FAIL; }
node -e '
const fs=require("fs");const j=JSON.parse(fs.readFileSync("app.json","utf8"));
j.expo.plugins=[...(j.expo.plugins||[]),["expo-sqlite",{useSQLCipher:true}]];
j.expo.android={...(j.expo.android||{}),package:"run.vyre.spike"};j.expo.ios={...(j.expo.ios||{}),bundleIdentifier:"run.vyre.spike"};
fs.writeFileSync("app.json",JSON.stringify(j,null,2));'
echo "expo-sqlite $(node -p 'require("expo-sqlite/package.json").version') expo $(node -p 'require("expo/package.json").version') rn $(node -p 'require("react-native/package.json").version')"
npx expo prebuild --platform all --no-install --clean 2>&1 | tail -5
ls android ios >/dev/null 2>&1 && res prebuild ok || res prebuild FAIL
echo "--- debug"; node -p 'JSON.stringify(require("./app.json").expo.plugins)'; ls node_modules/expo-sqlite/plugin* 2>&1 | head; cat android/gradle.properties | tail -15; cat ios/Podfile.properties.json 2>&1 | head -20; grep -rniE "cipher" node_modules/expo-sqlite/plugin/build/*.js node_modules/expo-sqlite/expo-module.config.json 2>/dev/null | head -12
echo "--- SQLCipher markers"; grep -rniE "sqlcipher" android/gradle.properties android/app/build.gradle ios/Podfile.properties.json ios/Podfile 2>/dev/null | head
{ grep -rqiE "useSQLCipher=true|sqlcipher" android/gradle.properties android/app/build.gradle 2>/dev/null && res android_sqlcipher_flag present; } || res android_sqlcipher_flag MISSING
{ grep -qiE "sqlcipher" ios/Podfile.properties.json ios/Podfile 2>/dev/null && res ios_sqlcipher_flag present; } || res ios_sqlcipher_flag MISSING
echo "--- android sdk: ANDROID_HOME=$ANDROID_HOME ANDROID_SDK_ROOT=$ANDROID_SDK_ROOT java=$(java -version 2>&1 | head -1)"
if [ -n "$ANDROID_HOME$ANDROID_SDK_ROOT" ] && command -v java >/dev/null; then
  (cd android && timeout 1500 ./gradlew :app:assembleDebug --no-daemon -q 2>&1 | tail -15) && res gradle_assembleDebug done_see_log
else res gradle_assembleDebug SKIPPED_no_android_sdk; fi
echo "--- Hermes compile of Yjs"
mkdir -p ../h && cd ../h && npm init -y >/dev/null && npm i --no-audit --no-fund yjs@13.6.27 esbuild >/dev/null 2>&1
echo 'import * as Y from "yjs"; const d=new Y.Doc(); d.getText("t").insert(0,"hi"); const u=Y.encodeStateAsUpdate(d); const e=new Y.Doc(); Y.applyUpdate(e,u); globalThis.out=e.getText("t").toString();' > e.mjs
npx esbuild e.mjs --bundle --format=iife --target=es2019 --outfile=b.js >/dev/null 2>&1 && res esbuild_yjs ok || res esbuild_yjs FAIL
HC=$(find "$W/app/node_modules" -type f -name hermesc 2>/dev/null | grep -i linux | head -1); echo "hermesc: $HC"; find "$W/app/node_modules" -maxdepth 3 -iname "*hermes*" | head
if [ -n "$HC" ]; then "$HC" -emit-binary -out b.hbc b.js && res hermesc_yjs ok_$(stat -c %s b.hbc)bytes || res hermesc_yjs FAIL; else res hermesc_yjs NO_HERMESC; fi
