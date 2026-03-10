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

module.exports = async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      pack,
      packName,
      eventName,
      eventDate,
      instaHandle,
      ticketLink,
      brief,
      transferLink,
      customerEmail,
      storyDates,
      postDate,
      datesPublication,
      afficheBase64,
      amount,
    } = req.body;

    // Validation
    if (!pack || !eventName || !eventDate || !instaHandle || !customerEmail || !datesPublication || !amount) {
      return res.status(400).json({ error: 'Paramètres manquants' });
    }

    // Upload affiche dans Firebase Storage (si fournie)
    let afficheUrl = null;
    if (afficheBase64) {
      try {
        const bucket = admin.storage().bucket();
        const filename = `instagram_sponsorships/${Date.now()}_${eventName.replace(/\s+/g, '_').toLowerCase()}.jpg`;
        const fileBuffer = Buffer.from(afficheBase64, 'base64');
        const file = bucket.file(filename);
        const token = require('crypto').randomUUID();
        await file.save(fileBuffer, {
          metadata: {
            contentType: 'image/jpeg',
            metadata: { firebaseStorageDownloadTokens: token },
          },
        });
        const encoded = encodeURIComponent(filename);
        afficheUrl = `https://firebasestorage.googleapis.com/v0/b/agendalgbt-app.firebasestorage.app/o/${encoded}?alt=media&token=${token}`;
      } catch (err) {
        console.warn('Upload affiche échoué (non bloquant):', err.message);
      }
    }

    // Dates de publication formatées
    const sortedDays = [...datesPublication].sort();
    const dateDebut = new Date(sortedDays[0]).toLocaleDateString('fr-FR');
    const dateFin   = new Date(sortedDays[sortedDays.length - 1]).toLocaleDateString('fr-FR');

    // Créer la session Stripe Checkout
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      customer_email: customerEmail,
      line_items: [
        {
          price_data: {
            currency: 'eur',
            product_data: {
              name: `${packName} — ${eventName}`,
              description: `Publication du ${dateDebut} au ${dateFin} · @agenda_lgbt`,
            },
            unit_amount: amount, // en centimes
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${process.env.NEXT_PUBLIC_BASE_URL}/success-instagram.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${process.env.NEXT_PUBLIC_BASE_URL}/instagram.html`,
      metadata: {
        type:             'instagram',
        pack,
        packName,
        eventName,
        eventDate,
        instaHandle,
        ticketLink:       ticketLink || '',
        brief:            (brief || '').slice(0, 500),
        transferLink:     transferLink || '',
        customerEmail,
        storyDates:       JSON.stringify(storyDates || []),
        postDate:         postDate || '',
        datesPublication: JSON.stringify(sortedDays),
        afficheUrl:       afficheUrl || '',
        amount:           String(amount),
      },
    });

    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json({ url: session.url });

  } catch (error) {
    console.error('Stripe error:', error);
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(500).json({ error: error.message });
  }
};
