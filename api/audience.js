const admin = require('firebase-admin');

// Initialiser Firebase Admin (une seule fois)
if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}

const db = admin.firestore();

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);

  if (isNaN(lat) || isNaN(lng)) {
    return res.status(400).json({ error: 'lat/lng manquants', count: 0 });
  }

  try {
    const snapshot = await db.collection('users').get();
    let count = 0;
    snapshot.forEach(doc => {
      const loc = doc.data().last_known_location;
      if (!loc) return;
      const d = haversine(lat, lng, loc.latitude, loc.longitude);
      if (d <= 30) count++;
    });
    return res.status(200).json({ count });
  } catch(e) {
    console.error('Audience error:', e);
    return res.status(500).json({ error: e.message, count: 0 });
  }
};
