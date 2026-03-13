const Stripe = require('stripe');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

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
    const { eventId, eventName, days, amount, amountHT, billingName, billingAddress, billingZip, billingCity } = req.body;

    if (!eventId || !eventName || !days || !amount) {
      return res.status(400).json({ error: 'Paramètres manquants' });
    }

    if (days.length < 3) {
      return res.status(400).json({ error: 'Minimum 3 jours requis' });
    }

    const sortedDays = [...days].sort();
    const dateDebut = new Date(sortedDays[0]).toLocaleDateString('fr-FR');
    const dateFin = new Date(sortedDays[sortedDays.length - 1]).toLocaleDateString('fr-FR');

    // Créer le customer Stripe avec les infos de facturation
    const customer = await stripe.customers.create({
      name: billingName || undefined,
      address: billingName ? {
        line1: billingAddress || '',
        postal_code: billingZip || '',
        city: billingCity || '',
        country: 'FR',
      } : undefined,
    });

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      customer: customer.id,
      line_items: [
        {
          price_data: {
            currency: 'eur',
            product_data: {
              name: `Sponsorisation — ${eventName}`,
              description: `${days.length} jour(s) · du ${dateDebut} au ${dateFin}`,
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
          description: `Sponsorisation AgendaLGBT — ${eventName} · du ${dateDebut} au ${dateFin}`,
          metadata: { eventId, eventName },
          rendering_options: { amount_tax_display: 'include_inclusive_tax' },
        },
      },
      success_url: `${process.env.NEXT_PUBLIC_BASE_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXT_PUBLIC_BASE_URL}/sponsor.html`,
      metadata: {
        eventId,
        eventName,
        days: JSON.stringify(days),
        amountHT: String(amountHT || amount),
        amount: String(amount),
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
