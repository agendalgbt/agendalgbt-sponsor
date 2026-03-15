# AgendaLGBT — Page Sponsorisation

## Structure
```
agendalgbt-sponsor/
├── public/
│   ├── sponsor.html        ← page organisateur
│   └── success.html        ← page après paiement Stripe
├── api/
│   ├── create-checkout.js  ← crée session Stripe
│   ├── webhook.js          ← reçoit confirmation + met à jour Firebase
│   ├── webhook-instagram.js← webhook Instagram
│   └── cron-sponsor.js     ← cron quotidien (activation/désactivation sponsoring)
├── vercel.json
└── package.json
```

## Variables d'environnement à configurer dans Vercel

Dans ton dashboard Vercel → projet → Settings → Environment Variables :

| Variable | Description |
|---|---|
| `STRIPE_SECRET_KEY` | Clé secrète Stripe live (`sk_live_...`) |
| `STRIPE_WEBHOOK_SECRET` | Secret du webhook Stripe live (`whsec_...`) |
| `FIREBASE_SERVICE_ACCOUNT` | JSON complet du compte de service Firebase (copier-coller) |
| `NEXT_PUBLIC_BASE_URL` | URL de ton projet Vercel (ex: https://agendalgbt-sponsor.vercel.app) |
| `CRON_SECRET` | Secret aléatoire pour sécuriser l'endpoint cron (générer avec `openssl rand -hex 32`) |

## Déploiement

1. Push ce dossier sur GitHub
2. Connecte Vercel à ce repo GitHub
3. Configure les variables d'environnement
4. Configure le webhook Stripe → URL : `https://ton-projet.vercel.app/api/webhook`

## Webhook Stripe

Dans ton dashboard Stripe → Developers → Webhooks → Add endpoint :
- URL : `https://ton-projet.vercel.app/api/webhook`
- Events : `checkout.session.completed`
- Utiliser les clés **live** (pas test) en production

## Cron Vercel

Le fichier `vercel.json` configure un cron quotidien à **minuit UTC** :
- Appelle `/api/cron-sponsor` toutes les nuits
- Active `isSponsored: true` pour les événements dont aujourd'hui est un jour sponsorisé
- Désactive `isSponsored: false` pour les événements dont le sponsoring est expiré
- Protégé par le header `Authorization: Bearer <CRON_SECRET>`

## Collection Firebase créée automatiquement

La collection `sponsorships` est créée automatiquement dans Firestore avec :
- `eventId`, `eventName`, `days`, `amount`, `stripe_session_id`
- `customer_email`, `status`, `created_at`, `sponsored_until`

## Firebase — champs mis à jour sur l'événement

Collection `activities` (document `eventId`) :

| Champ | Type | Description |
|---|---|---|
| `isSponsored` | `boolean` | `true` si aujourd'hui est un jour sponsorisé |
| `sponsored_until` | `Timestamp` | Fin du dernier jour sélectionné (23h59) |
| `sponsored_days` | `string[]` | Liste des jours sponsorisés (format `YYYY-MM-DD`) |
| `sponsored_at` | `Timestamp` | Date du paiement |
| `stripe_session_id` | `string` | ID de la session Stripe |
