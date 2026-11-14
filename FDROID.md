# Releasing Iron2FA

A `v*` tag makes `.github/workflows/release.yml` build one signed, minified APK
per ABI, check each is single-ABI, permission-free, signed and under 30 MB,
drive the x86_64 one on an emulator (`scripts/smoke-test-apk.sh` adds an account
and restarts the app), and attach all three to a GitHub Release. The self-hosted
F-Droid repo (<https://github.com/lbellows/fdroid>) collects them from there —
nightly, or at once with `gh workflow run "Publish F-Droid repo" -R lbellows/fdroid`.

## Cutting a release

1. Bump `expo.version` and `expo.android.versionCode` in `app.json`.
2. `npm run prebuild`
3. Write `fastlane/metadata/android/en-US/changelogs/<versionCode>.txt`, then
   `npm run changelogs` (copies it to each per-ABI versionCode,
   `versionCode * 10 + {1,2,3}`).
4. `npm run prebuild:check`
5. Commit, `git tag v<version>`, `git push origin main --tags`.

Running the workflow by hand (`gh workflow run "Release APK" -f abis=all`)
does everything except publish.

## Signing

| | |
|---|---|
| Keystore | `~/.android-signing/iron2fa-release.keystore` (PKCS12) |
| Password | `~/.android-signing/iron2fa-release.password` |
| Alias | `iron2fa` |

Neither file is in this repository. The repository secrets
`ANDROID_KEYSTORE_BASE64`, `ANDROID_STORE_PASSWORD` and `ANDROID_KEY_PASSWORD`
hold copies for CI and cannot be read back. **Lose the keystore and no installed
copy can ever be updated** — and since uninstalling deletes the vault, users
would have to export first. Keep it backed up off this machine.

The certificate's SHA-256 is pinned as `signing_key` for this app in the F-Droid
repo's `apps.json`; an APK signed with anything else is dropped from the index.

For a local signed build, put `storeFile`, `storePassword`, `keyAlias` and
`keyPassword` in `android/keystore.properties` (gitignored).

## Development caveat

`INTERNET` is stripped from the manifest, so a locally built dev APK cannot
reach Metro. Develop with `npm run web`, or temporarily remove it from
`blockedPermissions` in `app.json` and re-run `npm run prebuild`.
