const admin = require('firebase-admin');

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

module.exports = async function handler(req, res) {
  // Sécurité : vérifier le token Vercel Cron
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const todayStr = new Date().toISOString().split('T')[0]; // "YYYY-MM-DD"

  try {
    // Récupérer tous les événements qui ont des jours sponsorisés
    const snapshot = await db.collection('activities')
      .where('sponsored_days', '!=', null)
      .get();

    const batch = db.batch();
    let activated = 0;
    let deactivated = 0;

    snapshot.forEach(doc => {
      const data = doc.data();
      const sponsoredDays = data.sponsored_days;

      if (!Array.isArray(sponsoredDays) || sponsoredDays.length === 0) return;

      const shouldBeActive = sponsoredDays.includes(todayStr);

      if (shouldBeActive !== data.isSponsored) {
        batch.update(doc.ref, { isSponsored: shouldBeActive });
        shouldBeActive ? activated++ : deactivated++;
      }
    });

    await batch.commit();

    console.log(`✅ Cron sponsor : ${activated} activés, ${deactivated} désactivés (${todayStr})`);
    return res.status(200).json({ date: todayStr, activated, deactivated });

  } catch (err) {
    console.error('Cron sponsor error:', err);
    return res.status(500).json({ error: err.message });
  }
};
