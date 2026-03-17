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
      amount,
      amountHT,
      billingName,
      billingAddress,
      billingZip,
      billingCity,
    } = req.body;

    // Validation
    if (!pack || !eventName || !eventDate || !instaHandle || !customerEmail || !datesPublication || !amount) {
      return res.status(400).json({ error: 'Paramètres manquants' });
    }

    // Dates de publication formatées
    const sortedDays = [...datesPublication].sort();
    const dateDebut = new Date(sortedDays[0]).toLocaleDateString('fr-FR');
    const dateFin   = new Date(sortedDays[sortedDays.length - 1]).toLocaleDateString('fr-FR');

    // Créer le customer Stripe avec les infos de facturation
    const customer = await stripe.customers.create({
      email: customerEmail || undefined,
      name: billingName || undefined,
      address: billingName ? {
        line1: billingAddress || '',
        postal_code: billingZip || '',
        city: billingCity || '',
        country: 'FR',
      } : undefined,
    });

    // Créer la session Stripe Checkout
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      customer: customer.id,
      line_items: [
        {
          price_data: {
            currency: 'eur',
            product_data: {
              name: `${packName} — ${eventName}`,
              description: `Publication du ${dateDebut} au ${dateFin} · @agenda_lgbt`,
            },
            unit_amount: amountHT || amount,
            tax_behavior: 'exclusive',
          },
          quantity: 1,
          tax_rates: [process.env.STRIPE_TAX_RATE_ID],
        },
      ],
      mode: 'payment',
      invoice_creation: {
        enabled: true,
        invoice_data: {
          description: `${packName} AgendaLGBT — ${eventName}`,
          metadata: { pack, eventName, instaHandle },
          rendering_options: { amount_tax_display: 'include_inclusive_tax' },
        },
      },
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

        amount:           String(amount),
      },
    });

    // Mettre à jour le client Stripe avec les infos de facturation
    if (session.customer && billingName) {
      await stripe.customers.update(session.customer, {
        name: billingName,
        address: {
          line1: billingAddress || '',
          postal_code: billingZip || '',
          city: billingCity || '',
          country: 'FR',
        },
      });
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json({ url: session.url });

  } catch (error) {
    console.error('Checkout instagram error:', error);
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(500).json({ error: error.message });
  }
};

// Augmenter la limite bodyParser pour les uploads base64
module.exports.config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb',
    },
  },
};
