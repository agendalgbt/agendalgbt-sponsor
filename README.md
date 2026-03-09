# AgendaLGBT — Page Sponsorisation

## Structure
```
agendalgbt-sponsor/
├── public/
│   ├── sponsor.html     ← page organisateur
│   └── success.html     ← page après paiement Stripe
├── api/
│   ├── create-checkout.js  ← crée session Stripe
│   └── webhook.js          ← reçoit confirmation + met à jour Firebase
├── vercel.json
└── package.json
```

## Variables d'environnement à configurer dans Vercel

Dans ton dashboard Vercel → projet → Settings → Environment Variables :

| Variable | Description |
|---|---|
| `STRIPE_SECRET_KEY` | Clé secrète Stripe (sk_test_... ou sk_live_...) |
| `STRIPE_WEBHOOK_SECRET` | Secret du webhook Stripe (whsec_...) |
| `FIREBASE_SERVICE_ACCOUNT` | JSON complet du compte de service Firebase (copier-coller) |
| `NEXT_PUBLIC_BASE_URL` | URL de ton projet Vercel (ex: https://agendalgbt-sponsor.vercel.app) |

## Déploiement

1. Push ce dossier sur GitHub
2. Connecte Vercel à ce repo GitHub
3. Configure les variables d'environnement
4. Configure le webhook Stripe → URL : `https://ton-projet.vercel.app/api/webhook`

## Webhook Stripe

Dans ton dashboard Stripe → Developers → Webhooks → Add endpoint :
- URL : `https://ton-projet.vercel.app/api/webhook`
- Events : `checkout.session.completed`

## Collection Firebase créée automatiquement

La collection `sponsorships` est créée automatiquement dans Firestore avec :
- `eventId`, `eventName`, `days`, `amount`, `stripe_session_id`
- `customer_email`, `status`, `created_at`, `sponsored_until`

## Firebase — champs mis à jour sur l'événement

- `isSponsored: true`
- `sponsored_until: Timestamp`
- `sponsored_days: string[]`
- `sponsored_at: Timestamp`
- `stripe_session_id: string`
