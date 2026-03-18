const Stripe = require('stripe');
const admin = require('firebase-admin');
const { Resend } = require('resend');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

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

      // Envoyer un email de confirmation
      const customerEmail = meta.customerEmail || session.customer_details?.email;
      if (customerEmail && process.env.RESEND_API_KEY) {
        const datesPublication = JSON.parse(meta.datesPublication || '[]').sort();
        const dateDebut = new Date(datesPublication[0]).toLocaleDateString('fr-FR');
        const dateFin   = new Date(datesPublication[datesPublication.length - 1]).toLocaleDateString('fr-FR');

        const amountTTC = session.amount_total || 0;
        const amountHT  = parseInt(meta.amountHT || '0', 10);
        const amountTVA = amountTTC - amountHT;
        const fmt = (cents) => (cents / 100).toFixed(2).replace('.', ',');

        const storyDatesList = storyDates.sort()
          .map(d => new Date(d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))
          .map(d => `<li style="padding:2px 0;">${d}</li>`)
          .join('');

        const billingName    = meta.billingName    || '';
        const billingAddress = meta.billingAddress || '';
        const billingZip     = meta.billingZip     || '';
        const billingCity    = meta.billingCity    || '';
        const hasBilling     = billingName || billingAddress;

        // Récupérer l'URL PDF de la facture Stripe
        let invoicePdfUrl    = null;
        let invoiceHostedUrl = null;
        if (session.invoice) {
          try {
            const invoice    = await stripe.invoices.retrieve(session.invoice);
            invoicePdfUrl    = invoice.invoice_pdf;
            invoiceHostedUrl = invoice.hosted_invoice_url;
          } catch (e) {
            console.error('Erreur récupération facture:', e.message);
          }
        }

        await resend.emails.send({
          from:    'Agenda LGBT <no-reply@agendalgbt.com>',
          to:      customerEmail,
          subject: `Sponsorisation Instagram confirmée — ${meta.eventName}`,
          html: `
            <div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;">

              <!-- Header -->
              <div style="background:#c0398a;padding:32px 24px;text-align:center;border-radius:8px 8px 0 0;">
                <p style="color:white;font-size:22px;font-weight:bold;margin:0;">Agenda LGBT</p>
                <p style="color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:15px;">Confirmation de sponsorisation Instagram</p>
              </div>

              <!-- Body -->
              <div style="padding:32px 24px;background:#fff;border:1px solid #eee;border-top:none;border-radius:0 0 8px 8px;">
                <p style="margin-top:0;">Bonjour,</p>
                <p>Votre paiement a bien été reçu. Votre événement <strong>${meta.eventName}</strong> sera mis en avant sur le compte Instagram <strong>@agenda_lgbt</strong>.</p>

                <!-- Récap -->
                <h3 style="color:#c0398a;margin-top:32px;margin-bottom:12px;font-size:15px;text-transform:uppercase;letter-spacing:0.5px;">Récapitulatif</h3>
                <table style="width:100%;border-collapse:collapse;">
                  <tr style="border-bottom:1px solid #f0f0f0;">
                    <td style="padding:10px 0;color:#666;width:40%;">Pack</td>
                    <td style="padding:10px 0;"><strong>${meta.packName || meta.pack}</strong></td>
                  </tr>
                  <tr style="border-bottom:1px solid #f0f0f0;">
                    <td style="padding:10px 0;color:#666;">Événement</td>
                    <td style="padding:10px 0;"><strong>${meta.eventName}</strong></td>
                  </tr>
                  <tr style="border-bottom:1px solid #f0f0f0;">
                    <td style="padding:10px 0;color:#666;">Compte Instagram</td>
                    <td style="padding:10px 0;">@${meta.instaHandle}</td>
                  </tr>
                  <tr style="border-bottom:1px solid #f0f0f0;">
                    <td style="padding:10px 0;color:#666;vertical-align:top;">Stories</td>
                    <td style="padding:10px 0;">
                      ${storyDates.length} jour(s) · du ${dateDebut} au ${dateFin}
                      <ul style="margin:8px 0 0;padding-left:18px;color:#444;font-size:13px;">${storyDatesList}</ul>
                    </td>
                  </tr>
                  ${postDate ? `
                  <tr style="border-bottom:1px solid #f0f0f0;">
                    <td style="padding:10px 0;color:#666;">Post</td>
                    <td style="padding:10px 0;">${new Date(postDate).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</td>
                  </tr>` : ''}
                  <tr style="border-bottom:1px solid #f0f0f0;">
                    <td style="padding:10px 0;color:#666;">Montant HT</td>
                    <td style="padding:10px 0;">${fmt(amountHT)} €</td>
                  </tr>
                  <tr style="border-bottom:1px solid #f0f0f0;">
                    <td style="padding:10px 0;color:#666;">TVA (20 %)</td>
                    <td style="padding:10px 0;">${fmt(amountTVA)} €</td>
                  </tr>
                  <tr>
                    <td style="padding:10px 0;color:#666;">Total TTC</td>
                    <td style="padding:10px 0;font-size:18px;"><strong>${fmt(amountTTC)} €</strong></td>
                  </tr>
                </table>

                ${hasBilling ? `
                <!-- Infos de facturation -->
                <h3 style="color:#c0398a;margin-top:32px;margin-bottom:12px;font-size:15px;text-transform:uppercase;letter-spacing:0.5px;">Facturation</h3>
                <p style="margin:0;line-height:1.6;">
                  ${billingName    ? `${billingName}<br>`            : ''}
                  ${billingAddress ? `${billingAddress}<br>`         : ''}
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

                <p style="color:#aaa;font-size:12px;margin-top:24px;">Référence : ${session.id}</p>

                <hr style="border:none;border-top:1px solid #eee;margin:32px 0 24px;">
                <p style="color:#aaa;font-size:12px;text-align:center;margin:0;">
                  Agenda LGBT · <a href="https://agendalgbt.com" style="color:#c0398a;text-decoration:none;">agendalgbt.com</a>
                </p>
              </div>
            </div>
          `,
        });
        console.log(`📧 Email de confirmation Instagram envoyé à ${customerEmail}`);
      }

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
