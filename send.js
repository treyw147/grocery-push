/* Williams Family Grocery Plan — push sender.
   Runs on GitHub Actions every 30 min (free). Reads the reminders the app
   pre-computed in Firestore and delivers any that are due to both phones. */
const admin = require("firebase-admin");
const webpush = require("web-push");

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
});
webpush.setVapidDetails(
  "mailto:treywilliams147@gmail.com",
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

(async () => {
  const db = admin.firestore();
  const rem = (await db.doc("wfgp/reminders").get()).data();
  const subsDoc = (await db.doc("wfgp/push").get()).data() || {};
  const sent = (await db.doc("wfgp/sentlog").get()).data() || {};
  if (!rem || !rem.list || !rem.list.length) { console.log("no reminders queued"); return; }

  const now = Date.now();
  const WINDOW = 40 * 60 * 1000; // due within the last 40 min
  const due = rem.list.filter(r => r.t <= now && r.t > now - WINDOW);
  const updates = {}, dead = [];

  for (const r of due) {
    const id = r.type + "_" + new Date(r.t).toISOString().slice(0, 10);
    if (sent[id]) continue;
    for (const [k, v] of Object.entries(subsDoc)) {
      if (!v || !v.sub) continue;
      if (v.prefs && v.prefs[r.type] === false) continue; // phone opted out of this type
      try {
        await webpush.sendNotification(v.sub, JSON.stringify({ title: r.title, body: r.body, type: r.type }));
        console.log("sent", r.type, "->", v.name || k);
      } catch (e) {
        console.log("failed", v.name || k, e.statusCode || e.message);
        if (e.statusCode === 404 || e.statusCode === 410) dead.push(k); // phone unsubscribed
      }
    }
    updates[id] = true;
  }

  if (Object.keys(updates).length) await db.doc("wfgp/sentlog").set(updates, { merge: true });
  for (const k of dead) {
    await db.doc("wfgp/push").update({ [k]: admin.firestore.FieldValue.delete() }).catch(() => {});
  }
  console.log("done —", due.length, "due,", Object.keys(updates).length, "newly sent");
})();
