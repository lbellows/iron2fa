#!/usr/bin/env bash
# Installs a release APK on a running emulator and checks the app actually works.
#
# Release builds are minified, and nothing else in CI runs the app's crypto on
# Hermes, so this goes past "it launched": it adds an account through the UI,
# checks a code is displayed, then restarts the app and checks the account is
# still there. That exercises R8's output, the Keystore-held vault key, HMAC,
# and an AES-GCM encrypt/decrypt round trip through storage.
set -euo pipefail

APK=${1:?usage: scripts/smoke-test-apk.sh <apk>}
PACKAGE=com.irondeveloper.iron2fa
TIMEOUT_SECONDS=90

dump() {
  adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1 && adb shell cat /sdcard/ui.xml
}

screen_texts() {
  dump | grep -o -E '(text|content-desc)="[^"]+"' || echo "(no dump)"
}

# wait_for <python regex matched against the UI dump>
wait_for() {
  for _ in $(seq 1 $((TIMEOUT_SECONDS / 3))); do
    if dump | python3 -c 'import re,sys; sys.exit(0 if re.search(sys.argv[1], sys.stdin.read()) else 1)' "$1"; then
      return 0
    fi
    sleep 3
  done
  echo "::error::'$1' never appeared within ${TIMEOUT_SECONDS}s."
  echo "--- on screen ---"
  screen_texts
  echo
  echo "--- logcat ---"
  adb logcat -d | tail -200
  exit 1
}

# tap <exact text or content-desc of a node>
tap() {
  local point
  point=$(dump | python3 -c '
import re, sys, html
want = sys.argv[1]
nodes = [{k: html.unescape(v) for k, v in re.findall(r"([\w-]+)=\"([^\"]*)\"", node)}
         for node in re.findall(r"<node [^>]*>", sys.stdin.read())]
# A text field and its visible caption carry the same words: the field has them
# as content-desc, the caption as text. Prefer the field, or the tap lands on
# the caption and nothing gets focus.
hits = [n for n in nodes if n.get("content-desc") == want] or [n for n in nodes if n.get("text") == want]
if hits:
    x1, y1, x2, y2 = map(int, re.findall(r"\d+", hits[0]["bounds"]))
    print((x1 + x2) // 2, (y1 + y2) // 2)
' "$1")
  if [ -z "$point" ]; then
    echo "::error::nothing on screen is labelled '$1'."
    screen_texts
    exit 1
  fi
  # shellcheck disable=SC2086
  adb shell input tap $point
}

adb wait-for-device
adb logcat -c
adb install -r "$APK"
adb shell am start -W -n "${PACKAGE}/.MainActivity"

# A fresh install always shows the empty state.
wait_for 'No accounts yet'

tap '+ Add'
wait_for 'Add account'
tap 'Setup key or otpauth:// link'
adb shell "input text 'otpauth://totp/Smoke:test?secret=JBSWY3DPEHPK3PXP'"
wait_for 'text="otpauth://totp/Smoke:test\?secret=JBSWY3DPEHPK3PXP"'
# Back closes the soft keyboard if one is up, so Save is on screen. With no
# keyboard it leaves the form, hence the check.
if ! dump | grep -q 'text="Save"'; then
  adb shell input keyevent 4
  sleep 1
fi
tap 'Save'
# Back on the list, with the new account and a six-digit code.
wait_for 'text="Smoke"'
wait_for 'text="\d{3} \d{3}"'

# Cold start: the vault has to decrypt with the key held in the Keystore.
adb shell am force-stop "$PACKAGE"
adb shell am start -W -n "${PACKAGE}/.MainActivity"
wait_for 'text="Smoke"'
wait_for 'text="\d{3} \d{3}"'

if adb logcat -d | grep -q "FATAL EXCEPTION"; then
  echo "::error::The app crashed."
  adb logcat -d | grep -A 40 "FATAL EXCEPTION" | tail -80
  exit 1
fi

echo "Launched, added an account, showed a code, and reopened the vault after a restart."
