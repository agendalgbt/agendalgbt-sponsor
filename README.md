# AgendaLGBT — Système de Sponsorisation

Plateforme de sponsorisation pour AgendaLGBT, gérant deux types de sponsoring : **événements dans l'app** et **publications Instagram**.

## Structure du projet

```
agendalgbt-sponsor/
├── public/
│   ├── index.html                  ← page d'accueil (choix du type de sponsoring)
│   ├── sponsor.html                ← formulaire sponsoring événement (app)
│   ├── success.html                ← page de confirmation après paiement sponsoring
│   ├── instagram.html              ← formulaire sponsoring Instagram
│   └── success-instagram.html      ← page de confirmation après paiement Instagram
├── api/
│   ├── audience.js                 ← calcule l'audience dans un rayon de 30 km
│   ├── create-checkout.js          ← crée une session Stripe pour le sponsoring événement
│   ├── create-checkout-instagram.js← crée une session Stripe pour le sponsoring Instagram
│   ├── webhook.js                  ← webhook Stripe sponsoring événement
│   ├── webhook-instagram.js        ← webhook Stripe sponsoring Instagram
│   └── cron-sponsor.js             ← cron quotidien (activation/désactivation du sponsoring)
├── vercel.json
└── package.json
```

## Types de sponsoring

### 1. Sponsoring événement (App)
- Sélection de jours spécifiques (minimum 3 jours)
- Mise en avant de l'événement dans l'application AgendaLGBT
- Estimation de l'audience à proximité (rayon 30 km via formule de Haversine)
- Facturation avec TVA 20 % et génération automatique de facture Stripe

### 2. Sponsoring Instagram
- Packs de publications (stories et/ou posts sur @agenda_lgbt)
- Sélection des dates de stories et de post
- Upload de fichiers (visuels stories, image post)
- Gestion du calendrier de réservation (évite les doublons)

## API endpoints

| Endpoint | Méthode | Description |
|---|---|---|
| `/api/audience` | GET | Retourne le nombre d'utilisateurs dans un rayon de 30 km (`?lat=&lng=`) |
| `/api/create-checkout` | POST | Crée une session Stripe pour le sponsoring événement |
| `/api/create-checkout-instagram` | POST | Crée une session Stripe pour le sponsoring Instagram |
| `/api/webhook` | POST | Webhook Stripe — traite les paiements sponsoring événement |
| `/api/webhook-instagram` | POST | Webhook Stripe — traite les paiements sponsoring Instagram |
| `/api/cron-sponsor` | GET | Endpoint cron : met à jour les flags `isSponsored` dans Firebase |

## Variables d'environnement à configurer dans Vercel

Dans ton dashboard Vercel → projet → Settings → Environment Variables :

| Variable | Format | Description |
|---|---|---|
| `STRIPE_SECRET_KEY` | `sk_live_...` / `sk_test_...` | Clé secrète Stripe (live en prod, test en preview) |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` | Secret webhook Stripe — sponsoring événement |
| `STRIPE_WEBHOOK_SECRET_INSTAGRAM` | `whsec_...` | Secret webhook Stripe — sponsoring Instagram |
| `STRIPE_TAX_RATE_ID` | `txr_...` | ID du taux de TVA Stripe (20 %) |
| `FIREBASE_SERVICE_ACCOUNT` | JSON complet | Compte de service Firebase (copier-coller le JSON) |
| `NEXT_PUBLIC_BASE_URL` | URL | URL du projet (ex: `https://agendalgbt-sponsor.vercel.app`) |
| `CRON_SECRET` | chaîne aléatoire | Bearer token sécurisant l'endpoint cron (`openssl rand -hex 32`) |
| `RESEND_API_KEY` | `re_...` | Clé API Resend pour l'envoi des emails de confirmation |

### Environnement de test (Vercel Preview)

Dans Vercel → Settings → Environment Variables, tu peux définir des valeurs **différentes par environnement** (Production / Preview / Development) :

- **Preview** : `STRIPE_SECRET_KEY = sk_test_...` + `STRIPE_WEBHOOK_SECRET` correspondant au webhook test Stripe
- **Production** : `STRIPE_SECRET_KEY = sk_live_...`

Le webhook Stripe test doit pointer vers l'URL de preview Vercel (ex: `https://agendalgbt-sponsor-git-preview.vercel.app/api/webhook`).

## Déploiement

1. Push ce dossier sur GitHub
2. Connecte Vercel à ce repo GitHub
3. Configure les variables d'environnement
4. Configure les webhooks Stripe (voir ci-dessous)

## Webhooks Stripe

Dans ton dashboard Stripe → Developers → Webhooks → Add endpoint :

**Sponsoring événement :**
- URL : `https://ton-projet.vercel.app/api/webhook`
- Event : `checkout.session.completed`

**Sponsoring Instagram :**
- URL : `https://ton-projet.vercel.app/api/webhook-instagram`
- Event : `checkout.session.completed`

Utiliser les clés **live** (pas test) en production.

## Cron Vercel

Le fichier `vercel.json` configure un cron quotidien à **5h UTC (6h/7h heure française)** :
- Appelle `/api/cron-sponsor` toutes les nuits
- Active `isSponsored: true` pour les événements dont aujourd'hui est un jour sponsorisé
- Désactive `isSponsored: false` pour les événements dont le sponsoring est expiré
- Protégé par le header `Authorization: Bearer <CRON_SECRET>`

## Structure Firebase (Firestore)

### Collection `activities` (mise à jour lors d'un paiement)

| Champ | Type | Description |
|---|---|---|
| `isSponsored` | `boolean` | `true` si aujourd'hui est un jour sponsorisé |
| `sponsored_until` | `Timestamp` | Fin du dernier jour sélectionné (23h59:59) |
| `sponsored_days` | `string[]` | Jours sponsorisés au format `YYYY-MM-DD` |
| `sponsored_at` | `Timestamp` | Date du paiement |
| `stripe_session_id` | `string` | ID de la session Stripe |

### Collection `sponsorships` (créée automatiquement)

| Champ | Type | Description |
|---|---|---|
| `eventId` | `string` | Identifiant de l'événement |
| `eventName` | `string` | Nom de l'événement |
| `days` | `string[]` | Jours sponsorisés |
| `amount` | `number` | Montant en centimes |
| `stripe_session_id` | `string` | ID de la session Stripe |
| `customer_email` | `string` | Email du client |
| `orga_email` | `string` | Email de l'organisateur |
| `status` | `string` | `'active'` |
| `created_at` | `Timestamp` | Date de création |
| `sponsored_until` | `Timestamp` | Fin du sponsoring |

### Collection `instagram_booked_days` (calendrier Instagram)

| Champ | Type | Description |
|---|---|---|
| `story` | `boolean` | Ce jour est réservé pour une story |
| `post` | `boolean` | Ce jour est réservé pour un post |

### Collection `instagram_sponsorships` (créée automatiquement)

| Champ | Type | Description |
|---|---|---|
| `pack` | `string` | Identifiant du pack |
| `packName` | `string` | Nom du pack |
| `eventName` | `string` | Nom de l'événement |
| `eventDate` | `string` | Date de l'événement |
| `instaHandle` | `string` | Compte Instagram de l'organisateur |
| `ticketLink` | `string` | Lien billetterie |
| `brief` | `string` | Brief créatif |
| `transferLink` | `string` | Lien de transfert des fichiers |
| `customerEmail` | `string` | Email du client |
| `storyDates` | `string[]` | Dates des stories (`YYYY-MM-DD`) |
| `postDate` | `string` | Date du post (`YYYY-MM-DD`) |
| `datesPublication` | `string[]` | Dates de publication |
| `postFileUrl` | `string` | URL du visuel post |
| `storyUrls` | `string[]` | URLs des visuels stories |
| `amount` | `number` | Montant en centimes |
| `stripe_session_id` | `string` | ID de la session Stripe |
| `status` | `string` | `'confirmed'` |
| `created_at` | `Timestamp` | Date de création |
| `billingName` | `string` | Nom de facturation |
| `billingAddress` | `string` | Adresse de facturation |
| `billingZip` | `string` | Code postal |
| `billingCity` | `string` | Ville |

## Emails automatiques (Resend)

À chaque paiement confirmé, deux emails sont envoyés :

- **Email client** : confirmation avec récapitulatif du sponsoring, montant HT/TTC et lien vers la facture PDF Stripe
- **Email interne** : notification à `hello@agendalgbt.com` avec les détails de la commande

## Dépendances

| Package | Version | Usage |
|---|---|---|
| `stripe` | `^14.0.0` | Paiement et gestion des webhooks |
| `firebase-admin` | `^12.0.0` | Accès à Firestore |
| `resend` | `^3.0.0` | Envoi des emails transactionnels |
