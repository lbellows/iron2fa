# `com.irondeveloper.iron2fa.yml`

Listing metadata for the self-hosted F-Droid repo (<https://github.com/lbellows/fdroid>),
not a build recipe. That repo's publish workflow reads it through the `recipe`
key in its `apps.json` to fill in the licence, category, name and source link,
which `fdroid update` does not take from the fastlane tree. Renaming or moving
it makes Iron2FA publish as licence "Unknown".
