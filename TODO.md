# TODO

Security gaps found by comparing Iron2FA with Proton Authenticator's source
(2026-11-14). Ordered by how much each one matters.

## Android

- [ ] **App lock.** The vault opens with no prompt, so anyone holding the
      unlocked phone sees every code. Gate the Keystore key behind biometrics
      or the device credential (`expo-secure-store` `requireAuthentication`),
      and re-lock when the app goes to the background. The manifest currently
      removes `USE_BIOMETRIC`; that has to come back.
- [ ] **Mark copied codes as sensitive.** `Clipboard.setStringAsync` in
      `src/ui/List.tsx` copies plainly. Set `ClipDescription.EXTRA_IS_SENSITIVE`
      so Android 13+ hides the code in the clipboard preview.
- [ ] **Hide the screen from capture.** Set `FLAG_SECURE` on `MainActivity`
      (blocks screenshots, screen recording and the recents thumbnail).

## Desktop

- [ ] **Stop allowing `file:` requests.** The `onBeforeRequest` filter in
      `desktop/main.js` lets `file:` URLs through. The bundle is served from
      `app://`, so check whether anything still needs `file:` and drop it; the
      README says every other request is refused.
- [ ] **Idle auto-lock.** Only the manual Lock button exists. Lock after a
      period without input and when the window is hidden or minimised.
- [ ] **Stronger Argon2id for the vault.** `deriveKey` uses 19 MiB and 2 passes
      because that is what Proton's export format needs. The vault blob in
      `~/.config/Iron2FA` can be copied and brute-forced offline, so give the
      vault its own, heavier parameters (for example 64 MiB, 3 passes) and keep
      the Proton parameters for exports only. Needs a vault version bump and a
      re-encrypt on first unlock.
- [ ] **Content Security Policy.** Add a strict CSP to the served
      `index.html` (`default-src 'self'`, no remote sources) as a second
      barrier behind the request filter.

## Both

- [ ] **Make plaintext export harder to do by accident.** It is one button
      press with a hint under the field. Ask for confirmation when the
      password is empty.
- [ ] **Clear the clipboard** some seconds after copying a code, where the
      platform allows it.
- [ ] **Dependency exposure.** The lockfile resolves about 1,100 npm packages.
      Add `npm audit signatures` to CI, and check that the release build does
      not ship packages the app never imports.
- [ ] **Outside review.** The crypto primitives are `@noble` libraries, but
      `src/vault.ts`, `src/core/crypto.ts` and `src/core/proton.ts` have only
      been read by us.

## Already in good shape

For reference, so these are not re-litigated: no `INTERNET` permission on
Android, `allowBackup="false"`, AES-256-GCM with the key in the Keystore,
desktop vault always passphrase-derived, Electron window sandboxed with
context isolation, navigation and new windows denied.
