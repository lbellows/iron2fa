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

# Centre of the first node labelled $1, as "x y". Empty when nothing matches.
# A text field and its caption carry the same words: the field has them as
# content-desc, the caption as text. Prefer the field, or the tap lands on the
# caption and nothing gets focus.
node_center() {
  dump | python3 -c '
import re, sys, html
want = sys.argv[1]
nodes = [{k: html.unescape(v) for k, v in re.findall(r"([\w-]+)=\"([^\"]*)\"", node)}
         for node in re.findall(r"<node [^>]*>", sys.stdin.read())]
hits = [n for n in nodes if n.get("content-desc") == want] or [n for n in nodes if n.get("text") == want]
if not hits:
    sys.exit(0)
x1, y1, x2, y2 = map(int, re.findall(r"\d+", hits[0]["bounds"]))
print((x1 + x2) // 2, (y1 + y2) // 2)
' "$1"
}

# "width height" of the display the taps land on.
screen_size() {
  adb shell wm size | tr -d '\r' | awk '
    /Override size:/ { o = $3 }
    /Physical size:/ { p = $3 }
    END {
      s = (o ? o : p)
      split(s, a, "x")
      print a[1], a[2]
    }'
}

# tap <exact text or content-desc of a node>
# The UI dump lists nodes that are scrolled off the 320x640 emulator, and a tap
# at those coordinates hits nothing. Scroll until the centre is on the display.
tap() {
  local label=$1 point x y width height top bottom mid
  read -r width height < <(screen_size)
  # Stay clear of the status bar and the navigation bar. A centre just above
  # the bar still misses the button, which is what happened at y=585 on 640px.
  top=48
  bottom=$((height - 96))
  mid=$((width / 2))
  for _ in 1 2 3 4 5 6; do
    point=$(node_center "$label")
    if [ -z "$point" ]; then
      echo "::error::nothing on screen is labelled '$label'."
      screen_texts
      exit 1
    fi
    read -r x y <<<"$point"
    if [ "$y" -gt "$top" ] && [ "$y" -lt "$bottom" ]; then
      echo "tap '$label' at $x $y"
      adb shell input tap "$x" "$y"
      return 0
    fi
    echo "'$label' is at $x $y on a ${width}x${height} display; scrolling it into view"
    if [ "$y" -ge "$bottom" ]; then
      adb shell input swipe "$mid" $((height * 3 / 4)) "$mid" $((height / 3)) 300
    else
      adb shell input swipe "$mid" $((height / 3)) "$mid" $((height * 3 / 4)) 300
    fi
    sleep 1
  done
  echo "::error::'$label' stayed off the ${width}x${height} display."
  screen_texts
  exit 1
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
# The soft keyboard covers Save, and the UI dump still lists the button
# underneath it, so a tap there hits the keyboard. Back closes the keyboard;
# with none showing, Back leaves the form instead. A slow emulator shows the
# keyboard a few seconds after the text lands, so wait for it to report itself.
ime_shown=0
for _ in 1 2 3 4 5 6 7 8; do
  if adb shell dumpsys input_method | tr -d '\r' | grep -q 'mInputShown=true'; then
    ime_shown=1
    break
  fi
  sleep 1
done
if [ "$ime_shown" = 1 ]; then
  echo "closing the soft keyboard"
  adb shell input keyevent 4
  sleep 1
else
  echo "soft keyboard was not shown"
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
