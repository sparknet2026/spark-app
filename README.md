# Peday Commission — Native Android App

A **backend-less** Android app. It talks to the **peday / spark dashboards directly**
(the user signs in with their own peday admin account), and computes commission +
the risk engine **on the device** in JavaScript. No server of ours to host.

- **Environments:** Peday (`dashboard.peday.money`) and **Spark** (`dashboard.sparkpay.in`) —
  switch on the login screen or the Home tab. Same login works on both.
- **Login:** the user's own peday admin email/password → peday returns a token, kept
  only on the device (localStorage). Nothing is hardcoded, nothing goes to any server of ours.
- **Screens:** Home (commission today, total txns, vendor split), Risk (9-rule engine),
  Wallet ledger, Settings (per-device alerts, voice alarm).

## Why native (not a web page)
The peday APIs do **not** send CORS headers, so a browser blocks direct calls. A native
app (Capacitor / Android WebView) is **not** subject to browser CORS, so the direct calls
work. That is why this must be built as an APK, not opened as a website.

## Files
```
mobile/
  www/
    index.html   UI
    app.js       controller (login, screens, alarm)
    peday.js     peday/spark API client (login, paginated fetch)
    logic.js     commission + 9-rule risk engine (ported from the Python backend)
  capacitor.config.json
  package.json
```

## Build the APK (on a machine with Node + Android Studio)
```bash
cd mobile
npm install                 # gets Capacitor
npx cap add android         # creates the android/ project
npx cap sync android        # copies www/ into it
npx cap open android        # opens Android Studio -> Run, or Build > Build APK
```
The debug APK lands in `android/app/build/outputs/apk/debug/app-debug.apk`.
For a release build, generate a keystore and use **Build > Generate Signed Bundle / APK**.

## Requirements to compile
- Node.js 18+
- Android Studio (Android SDK, platform-tools)
- JDK 17

> Note: the APK cannot be compiled here (no Android SDK in this environment). All the
> source is ready — run the steps above on your machine to produce the installable APK.

## Tuning risk thresholds
Defaults live in `logic.js` (`DEFAULT_RULES`) and can be overridden per device
(saved under `localStorage["peday_rules"]`). Rules: same_account, same_mobile,
same_borrower, volume_spike, after_hours, high_value_txn (₹50,000), structuring,
high_failure_rate, round_amount.
