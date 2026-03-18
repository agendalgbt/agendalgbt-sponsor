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

        const amountTTC = session.amount_total || 0;
        const amountHT = parseInt(session.metadata.amountHT || '0', 10);
        const amountTVA = amountTTC - amountHT;

        const fmt = (cents) => (cents / 100).toFixed(2).replace('.', ',');
        const montantHT = fmt(amountHT);
        const montantTVA = fmt(amountTVA);
        const montantTTC = fmt(amountTTC);

        const billingName = session.metadata.billingName || '';
        const billingAddress = session.metadata.billingAddress || '';
        const billingZip = session.metadata.billingZip || '';
        const billingCity = session.metadata.billingCity || '';
        const hasBilling = billingName || billingAddress;

        const daysList = parsedDays
          .sort()
          .map(d => new Date(d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))
          .map(d => `<li style="padding:2px 0;">${d}</li>`)
          .join('');

        // Récupérer l'URL PDF de la facture Stripe
        let invoicePdfUrl = null;
        let invoiceHostedUrl = null;
        if (session.invoice) {
          try {
            const invoice = await stripe.invoices.retrieve(session.invoice);
            invoicePdfUrl = invoice.invoice_pdf;
            invoiceHostedUrl = invoice.hosted_invoice_url;
          } catch (e) {
            console.error('Erreur récupération facture:', e.message);
          }
        }

        await resend.emails.send({
          from: 'Agenda LGBT <no-reply@agendalgbt.com>',
          to: orgaEmail,
          subject: `Sponsorisation confirmée — ${eventName}`,
          html: `
            <div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;">

              <!-- Header -->
              <div style="background:#c0398a;padding:32px 24px;text-align:center;border-radius:8px 8px 0 0;">
                <p style="color:white;font-size:22px;font-weight:bold;margin:0;">Agenda LGBT</p>
                <p style="color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:15px;">Confirmation de sponsorisation</p>
              </div>

              <!-- Body -->
              <div style="padding:32px 24px;background:#fff;border:1px solid #eee;border-top:none;border-radius:0 0 8px 8px;">
                <p style="margin-top:0;">Bonjour,</p>
                <p>Votre paiement a bien été reçu. L'événement <strong>${eventName}</strong> sera mis en avant sur Agenda LGBT aux dates sélectionnées.</p>

                <!-- Récap événement -->
                <h3 style="color:#c0398a;margin-top:32px;margin-bottom:12px;font-size:15px;text-transform:uppercase;letter-spacing:0.5px;">Récapitulatif</h3>
                <table style="width:100%;border-collapse:collapse;">
                  <tr style="border-bottom:1px solid #f0f0f0;">
                    <td style="padding:10px 0;color:#666;width:40%;">Événement</td>
                    <td style="padding:10px 0;"><strong>${eventName}</strong></td>
                  </tr>
                  <tr style="border-bottom:1px solid #f0f0f0;">
                    <td style="padding:10px 0;color:#666;vertical-align:top;">Jours sponsorisés</td>
                    <td style="padding:10px 0;">
                      <strong>${parsedDays.length} jour(s)</strong> · du ${dateDebut} au ${dateFin}
                      <ul style="margin:8px 0 0;padding-left:18px;color:#444;font-size:13px;">${daysList}</ul>
                    </td>
                  </tr>
                  <tr style="border-bottom:1px solid #f0f0f0;">
                    <td style="padding:10px 0;color:#666;">Montant HT</td>
                    <td style="padding:10px 0;">${montantHT} €</td>
                  </tr>
                  <tr style="border-bottom:1px solid #f0f0f0;">
                    <td style="padding:10px 0;color:#666;">TVA (20 %)</td>
                    <td style="padding:10px 0;">${montantTVA} €</td>
                  </tr>
                  <tr>
                    <td style="padding:10px 0;color:#666;">Total TTC</td>
                    <td style="padding:10px 0;font-size:18px;"><strong>${montantTTC} €</strong></td>
                  </tr>
                </table>

                ${hasBilling ? `
                <!-- Infos de facturation -->
                <h3 style="color:#c0398a;margin-top:32px;margin-bottom:12px;font-size:15px;text-transform:uppercase;letter-spacing:0.5px;">Facturation</h3>
                <p style="margin:0;line-height:1.6;">
                  ${billingName ? `${billingName}<br>` : ''}
                  ${billingAddress ? `${billingAddress}<br>` : ''}
                  ${billingZip || billingCity ? `${billingZip} ${billingCity}` : ''}
                </p>
                ` : ''}

                <!-- Facture -->
                ${invoicePdfUrl ? `
                <h3 style="color:#c0398a;margin-top:32px;margin-bottom:12px;font-size:15px;text-transform:uppercase;letter-spacing:0.5px;">Facture</h3>
                <p style="margin:0;">
                  <a href="${invoicePdfUrl}" style="display:inline-block;background:#c0398a;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;font-size:14px;">Télécharger la facture PDF</a>
                  ${invoiceHostedUrl ? `&nbsp; <a href="${invoiceHostedUrl}" style="color:#c0398a;font-size:14px;">Voir en ligne</a>` : ''}
                </p>
                ` : ''}

                <!-- Référence -->
                <p style="color:#aaa;font-size:12px;margin-top:4px;">Référence : ${session.id}</p>

                <!-- Footer -->
                <hr style="border:none;border-top:1px solid #eee;margin:32px 0 24px;">
                <p style="color:#aaa;font-size:12px;text-align:center;margin:0;">
                  Agenda LGBT · <a href="https://agendalgbt.com" style="color:#c0398a;text-decoration:none;">agendalgbt.com</a>
                </p>
              </div>
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
