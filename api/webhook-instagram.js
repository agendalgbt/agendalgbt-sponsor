const Stripe = require('stripe');
const admin = require('firebase-admin');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: 'agendalgbt-app.firebasestorage.app',
  });
}

const db = admin.firestore();

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const sig     = req.headers['stripe-signature'];
  const rawBody = await getRawBody(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET_INSTAGRAM);
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const meta    = session.metadata || {};

    if (meta.type !== 'instagram') {
      return res.status(200).json({ received: true });
    }

    try {
      const storyDates = JSON.parse(meta.storyDates || '[]');
      const postDate   = meta.postDate || null;

      const batch = db.batch();

      // Bloquer les dates STORIES
      storyDates.forEach(dateStr => {
        const ref = db.collection('instagram_booked_days').doc(dateStr);
        batch.set(ref, {
          date:  dateStr,
          story: true,
        }, { merge: true }); // merge: true pour ne pas écraser un éventuel post déjà réservé
      });

      // Bloquer la date POST (si applicable)
      if (postDate) {
        const ref = db.collection('instagram_booked_days').doc(postDate);
        batch.set(ref, {
          date: postDate,
          post: true,
        }, { merge: true });
      }

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
        transferLink:      meta.transferLink || '',
        customerEmail:     meta.customerEmail || session.customer_details?.email || '',
        storyDates:        storyDates,
        postDate:          postDate,
        datesPublication:  JSON.parse(meta.datesPublication || '[]'),
        postFileUrl:       meta.postFileUrl || '',
        storyUrls:         JSON.parse(meta.storyUrls || '[]'),
        amount:            session.amount_total,
        stripe_session_id: session.id,
        status:            'confirmed',
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

module.exports.config = {
  api: { bodyParser: false },
};
