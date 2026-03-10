const Stripe = require('stripe');
const admin = require('firebase-admin');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Initialiser Firebase Admin (une seule fois)
if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: 'agendalgbt-app.firebasestorage.app',
  });
}

const db = admin.firestore();

// Désactiver le body parser de Vercel (requis par Stripe)
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

  const sig     = req.headers['stripe-signature'];
  const rawBody = await getRawBody(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET_INSTAGRAM  // clé webhook dédiée Instagram
    );
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  if (event.type === 'checkout.session.completed') {
    const session  = event.data.object;
    const meta     = session.metadata || {};

    // Vérifier que c'est bien un paiement Instagram
    if (meta.type !== 'instagram') {
      console.log('Webhook ignoré — pas un paiement Instagram');
      return res.status(200).json({ received: true });
    }

    try {
      const parsedDates  = JSON.parse(meta.datesPublication || '[]');
      const sortedDates  = [...parsedDates].sort();

      // Bloquer les dates dans Firebase pour éviter les doubles réservations
      const batch = db.batch();
      sortedDates.forEach(dateStr => {
        const ref = db.collection('instagram_booked_days').doc(dateStr);
        batch.set(ref, {
          date:             dateStr,
          eventName:        meta.eventName,
          pack:             meta.pack,
          stripe_session_id: session.id,
          booked_at:        admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
      });
      await batch.commit();

      // Enregistrer la sponsorisation complète
      await db.collection('instagram_sponsorships').add({
        pack:              meta.pack,
        packName:          meta.packName,
        eventName:         meta.eventName,
        eventDate:         meta.eventDate,
        instaHandle:       meta.instaHandle,
        ticketLink:        meta.ticketLink || '',
        brief:             meta.brief || '',
        customerEmail:     meta.customerEmail || session.customer_details?.email || '',
        datesPublication:  sortedDates,
        afficheUrl:        meta.afficheUrl || '',
        amount:            session.amount_total, // en centimes
        stripe_session_id: session.id,
        status:            'confirmed', // confirmed → en_cours → traite
        created_at:        admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log(`✅ Instagram sponsorisation confirmée : ${meta.eventName} (${meta.pack})`);

    } catch (err) {
      console.error('Firebase error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(200).json({ received: true });
};
