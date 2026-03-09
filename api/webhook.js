const Stripe = require('stripe');
const admin = require('firebase-admin');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Initialiser Firebase Admin (une seule fois)
if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

// Désactiver le body parser de Vercel pour lire le raw body (requis par Stripe)
export const config = {
  api: {
    bodyParser: false,
  },
};

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sig = req.headers['stripe-signature'];
  const rawBody = await getRawBody(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  // Traiter uniquement les paiements réussis
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { eventId, days } = session.metadata;

    if (!eventId || !days) {
      console.error('Metadata manquante dans la session Stripe');
      return res.status(400).json({ error: 'Metadata manquante' });
    }

    try {
      const parsedDays = JSON.parse(days);
      const sortedDays = [...parsedDays].sort();
      const lastDay = new Date(sortedDays[sortedDays.length - 1]);
      // sponsored_until = fin du dernier jour sélectionné (23h59)
      lastDay.setHours(23, 59, 59, 999);

      // Mettre à jour l'événement dans Firebase
      await db.collection('activities').doc(eventId).update({
        isSponsored: true,
        sponsored_until: admin.firestore.Timestamp.fromDate(lastDay),
        sponsored_days: parsedDays,
        sponsored_at: admin.firestore.FieldValue.serverTimestamp(),
        stripe_session_id: session.id,
      });

      console.log(`✅ Événement ${eventId} sponsorisé jusqu'au ${lastDay.toISOString()}`);

      // Enregistrer la transaction dans une collection dédiée (pour la page admin)
      await db.collection('sponsorships').add({
        eventId,
        eventName: session.metadata.eventName,
        days: parsedDays,
        amount: session.amount_total, // en centimes
        stripe_session_id: session.id,
        customer_email: session.customer_details?.email || '',
        status: 'active',
        created_at: admin.firestore.FieldValue.serverTimestamp(),
        sponsored_until: admin.firestore.Timestamp.fromDate(lastDay),
      });

    } catch (err) {
      console.error('Firebase update error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  // Gérer l'expiration automatique (optionnel, via un cron Vercel)
  if (event.type === 'checkout.session.expired') {
    console.log('Session expirée:', event.data.object.id);
  }

  return res.status(200).json({ received: true });
};
