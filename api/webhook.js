const Stripe = require('stripe');
const admin = require('firebase-admin');
const { Resend } = require('resend');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

// Initialiser Firebase Admin (une seule fois)
if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
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

      // isSponsored = true uniquement si aujourd'hui est un jour sponsorisé
      const todayStr = new Date().toISOString().split('T')[0];
      const isActiveToday = parsedDays.includes(todayStr);

      // Mettre à jour l'événement dans Firebase
      await db.collection('activities').doc(eventId).update({
        isSponsored: isActiveToday,
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
        orga_email: session.metadata.orgaEmail || '',
        status: 'active',
        created_at: admin.firestore.FieldValue.serverTimestamp(),
        sponsored_until: admin.firestore.Timestamp.fromDate(lastDay),
      });

      // Envoyer un email de confirmation à l'organisateur
      const orgaEmail = session.metadata.orgaEmail;
      if (orgaEmail && process.env.RESEND_API_KEY) {
        const eventName = session.metadata.eventName;
        const dateDebut = new Date(sortedDays[0]).toLocaleDateString('fr-FR');
        const dateFin = new Date(sortedDays[sortedDays.length - 1]).toLocaleDateString('fr-FR');
        const montantTTC = ((session.amount_total || 0) / 100).toFixed(2).replace('.', ',');

        await resend.emails.send({
          from: 'AgendaLGBT <no-reply@agendalgbt.com>',
          to: orgaEmail,
          subject: `✅ Sponsorisation confirmée — ${eventName}`,
          html: `
            <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a;">
              <h2 style="color:#c0398a;">Votre sponsorisation est confirmée !</h2>
              <p>Bonjour,</p>
              <p>Votre paiement a bien été reçu. Votre événement <strong>${eventName}</strong> sera mis en avant sur AgendaLGBT.</p>
              <table style="width:100%;border-collapse:collapse;margin:20px 0;">
                <tr><td style="padding:8px 0;color:#666;">Période</td><td style="padding:8px 0;"><strong>du ${dateDebut} au ${dateFin}</strong> (${parsedDays.length} jour(s))</td></tr>
                <tr><td style="padding:8px 0;color:#666;">Montant TTC</td><td style="padding:8px 0;"><strong>${montantTTC} €</strong></td></tr>
              </table>
              <p>Votre facture sera disponible dans votre email de reçu Stripe.</p>
              <p style="color:#666;font-size:13px;margin-top:32px;">AgendaLGBT · <a href="https://agendalgbt.com" style="color:#c0398a;">agendalgbt.com</a></p>
            </div>
          `,
        });
        console.log(`📧 Email de confirmation envoyé à ${orgaEmail}`);
      }

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

// Désactiver le body parser de Vercel pour lire le raw body (requis par Stripe)
module.exports.config = {
  api: {
    bodyParser: false,
  },
};
