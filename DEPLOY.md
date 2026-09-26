# AUNA — Publishing changes

| What | How |
|---|---|
| Publish anything | Double-click **`deploy.bat`** and choose an option |
| Test locally with fake data | Double-click **`test-local.bat`** (logins: `doctor1@auna.test`, `doctor2@auna.test`, `recepcion@auna.test`, password `prueba123`) |
| Check security rules locally | `node tools/test-rules.js` (with test-local running) |
| Run the scheduled jobs locally | `node tools/test-scheduled.js` (with test-local running) |

- **Website** (admin panel + TV): GitHub Pages, published from `main`. Live 1–10 minutes after the push.
- **Cloud Functions, indexes, rules**: Firebase project `auna-board`, via the Firebase CLI. No secrets or API keys
  are needed.

## First production rollout (one time, in this order)

1. `deploy.bat` → **4** (functions + website). It lists the old WhatsApp functions it will delete and asks once.
2. **Reload each TV by hand** so it runs the new `display.js` (the old version has no automatic reload; from now on
   the TVs reload themselves every night at 3 AM).
3. `deploy.bat` → **3** (security rules). From now on the `doctors` collection is private and the TV reads `board`.
4. **Reception account**: Firebase Console → Authentication → *Add user*; copy the UID. Firestore → collection
   `staff` → document ID = that UID → fields `role` = `receptionist`, `name` = `…`, `active` = `true`.
5. Tell doctors to **re-subscribe to the calendar link** (Ajustes → Obtener enlace). Old links now show an
   "enlace caducado" notice instead of patient data.

## TV board

- `index.html?debug=1` shows the TV browser's real screen size and installed fonts.
- `index.html?stage=1` shows the new fixed-canvas layout (to be calibrated from the debug numbers).
