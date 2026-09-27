# CRM SDA — devis, factures et clients

Mini-CRM mono-utilisateur pour SDA Digital Agency : fiches clients, catalogue de prestations,
devis → factures, suivi des paiements, tableau de bord et PDF.

**Stack** : Cloudflare Pages + Pages Functions (TypeScript) + D1 (SQLite), frontend HTML/CSS/JS
sans framework. PDF générés côté serveur avec `pdf-lib`.

## Démarrer en local

```bash
npm install
npm run db:migrate:local      # crée le schéma dans la base locale
npm run db:seed:local         # OPTIONNEL : données de démo fictives (efface la base locale)
npm run dev                   # http://localhost:8788
```

Sans fichier `.dev.vars`, l'authentification est désactivée **uniquement sur localhost** ;
sur tout autre hôte, l'app répond 503 tant que les identifiants ne sont pas configurés.

Pour tester la connexion en local :

```bash
npm run hash-password -- "un-mot-de-passe-long"
cp .dev.vars.example .dev.vars   # puis coller le hash dans ADMIN_PASSWORD_HASH
```

## Déployer sur Cloudflare

```bash
npx wrangler d1 create crm-sda            # copier le database_id dans wrangler.toml
npm run db:migrate:remote
npx wrangler pages project create crm-sda
npx wrangler pages secret put ADMIN_EMAIL --project-name crm-sda
npx wrangler pages secret put ADMIN_PASSWORD_HASH --project-name crm-sda
npm run deploy
```

Le seed de démo refuse de s'exécuter en `--remote` et n'est pas dans `migrations/`
(sinon `migrations apply --remote` l'appliquerait en production).

## Règles métier

- **Montants en centimes** (entiers) partout : aucune erreur d'arrondi flottant.
- **Taux de taxe figé** sur chaque document à sa création ; le changer dans Paramètres n'altère pas l'existant.
- **Devis** : numéroté à la création (`DEV-2026-0001`), statuts brouillon → envoyé → accepté/refusé → facturé.
- **Factures** : un brouillon n'a pas de numéro. Le numéro (`FAC-2026-0001`) est attribué à
  l'**émission**, dans la même transaction que le compteur : numérotation continue, sans trou.
  Une facture émise est figée, ne peut pas être supprimée, seulement annulée (numéro conservé).
- **Conversion devis → facture** atomique : un double clic ne crée pas deux factures.
- **Paiements** partiels ou complets ; le statut « Payée » est recalculé automatiquement ; trop-perçu refusé.
- **RGPD** : un client sans document est supprimé ; un client avec devis/factures est
  **anonymisé** (données personnelles effacées, pièces comptables conservées).

## Limites connues — à lire

1. **Facturation électronique obligatoire.** Selon impots.gouv.fr et economie.gouv.fr, toutes les
   entreprises doivent pouvoir **recevoir** des factures électroniques depuis le 1er septembre 2026,
   et les PME / micro-entreprises devront les **émettre** au format électronique via une plateforme
   agréée à partir du **1er septembre 2027**. Un PDF envoyé par email ne suffira plus pour les factures
   entre entreprises assujetties en France. Cet outil ne transmet pas encore via une plateforme agréée :
   à prévoir avant septembre 2027 (export Factur-X ou intégration d'une plateforme agréée).
   Sources : [impots.gouv.fr — calendrier](https://www.impots.gouv.fr/professionnel/questions/partir-de-quand-suis-je-concerne-par-la-reforme-de-la-facturation),
   [economie.gouv.fr — tout savoir](https://www.economie.gouv.fr/tout-savoir-sur-la-facturation-electronique-pour-les-entreprises).
2. **Pas d'avoirs** : annuler une facture déjà envoyée devrait s'accompagner d'un avoir (non géré).
3. **Pas d'envoi d'email intégré** : le bouton prépare un email ; le PDF est à joindre à la main.
4. **Mentions légales** : les textes par défaut (pénalités de retard, indemnité de 40 €) sont un point
   de départ, à faire valider par un expert-comptable.

## Design

Monde visuel « Lagon » : fond vivant turquoise/corail, verre réservé aux surfaces qui flottent
(navigation, colonne d'actions, dialogues), panneaux plus denses pour la lisibilité des chiffres.
Thème clair / sombre / système. Tokens dans `public/css/tokens.css`, un seul accent à changer.
Couleurs des séries de graphiques validées (daltonisme, contraste) en clair et en sombre.

## Structure

```
functions/            API (Pages Functions) — _middleware.ts gère l'auth
  lib/                auth PBKDF2, calculs, numérotation, génération PDF
migrations/           schéma D1
public/               app (routeur SPA léger) + page /login
scripts/              hash de mot de passe, seed de démo, génération des icônes
```
