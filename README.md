# CRM SDA — devis, factures et clients

Mini-CRM mono-utilisateur pour SDA Digital Agency : fiches clients, catalogue de prestations,
devis → factures, suivi des paiements, tableau de bord et PDF.

**Stack** : Cloudflare Pages + Pages Functions (TypeScript) + D1 (SQLite), frontend HTML/CSS/JS
sans framework. PDF générés **dans le navigateur** avec `pdf-lib` (voir « PDF » plus bas).

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

## Déployer sur Cloudflare (tableau de bord, sans ligne de commande)

Les libellés exacts du tableau de bord Cloudflare peuvent varier légèrement.

1. **Base de données** — *Storage & Databases → D1 → Create* : nommer `crm-sda`, puis copier le **Database ID**
   dans `wrangler.toml` (`database_id`) et le pousser sur `main`. Ce n'est pas un secret.
2. **Schéma** — ouvrir la base → *Console* → coller le contenu de [`deploy/d1-setup.sql`](deploy/d1-setup.sql)
   → *Execute*. Contrôle : `SELECT name FROM d1_migrations;` doit renvoyer 3 lignes.
   Ce fichier enregistre les migrations comme `wrangler` : `npm run db:migrate:remote` restera utilisable.
   Il se régénère avec `npm run build:d1-setup` et ne contient aucune donnée de démo.
3. **Mot de passe** — télécharger [`scripts/hash-password.html`](scripts/hash-password.html), l'ouvrir en local
   dans le navigateur, générer le hash. Rien n'est envoyé sur Internet.
4. **Projet Pages** — *Workers & Pages → Create → Pages → Connect to Git* → dépôt `sxmdigitalagency/crm-SDA` :
   - branche de production : `main`
   - framework : *None* · commande de build : `npm run build` · répertoire de sortie : `public`
5. **Secrets** — projet → *Settings → Variables and secrets* → environnement **Production** → ajouter en type
   *Secret* : `ADMIN_EMAIL` (votre email) et `ADMIN_PASSWORD_HASH` (le hash de l'étape 3). Relancer un déploiement
   (*Deployments → Retry*) : un secret ne s'applique qu'aux nouveaux déploiements.
6. **Aperçus** — *Settings → Builds → Branch control* : désactiver les déploiements d'aperçu, ou ne jamais y
   définir les secrets. Les aperçus utilisent la **même base D1** que la production (binding unique dans
   `wrangler.toml`) ; sans secrets ils répondent 503, ce qui les rend inoffensifs.

Tant que les secrets ne sont pas définis, le site en ligne répond **503** partout : il ne s'ouvre jamais sans mot de passe.

### Alternative en ligne de commande

```bash
npx wrangler d1 create crm-sda            # copier le database_id dans wrangler.toml
npm run db:migrate:remote
npx wrangler pages secret put ADMIN_EMAIL --project-name crm-sda
npx wrangler pages secret put ADMIN_PASSWORD_HASH --project-name crm-sda
npm run deploy
```

Le seed de démo refuse de s'exécuter en `--remote` et n'est pas dans `migrations/`.

**Connexion** : 10 échecs depuis une même adresse IP bloquent les tentatives pendant 15 minutes.

## Production

- **Branche de production : `main`.** Chaque push sur `main` redéploie automatiquement le site.
  Les évolutions arrivent par la branche de travail puis sont fusionnées dans `main`.
- **Aperçus désactivés** (Paramètres → Builds → Contrôle des branches) : ils partageraient la base de production.
- **Secrets** définis dans Cloudflare Pages (Production) : `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`.
  Changer de mot de passe : régénérer le hash avec `scripts/hash-password.html`, remplacer le secret, redéployer.
- **Nouvelle migration** : l'appliquer depuis un poste connecté à Cloudflare **avant** de pousser le code qui en dépend :
  `npx wrangler d1 migrations apply crm-sda --remote`.



- **Montants en centimes** (entiers) partout : aucune erreur d'arrondi flottant.
- **Taxe par défaut : TGCA 4 %** (Saint-Martin). Taux propre possible par client (vide = défaut), modifiable
  sur chaque document tant qu'il est en brouillon, puis **figé** : changer Paramètres n'altère pas l'existant.
- **Deux devises, EUR et USD**, choisies par client et héritées par ses devis/factures. Les montants de devises
  différentes ne sont **jamais additionnés** : totaux séparés dans les listes, tableau de bord filtré par devise
  (pas de conversion, faute de taux de change fiable).
- **Devis** : numéroté à la création (`DEV-2026-0001`), statuts brouillon → envoyé → accepté/refusé → facturé.
- **Factures** : un brouillon n'a pas de numéro. Le numéro (`FAC-2026-0001`) est attribué à
  l'**émission**, dans la même transaction que le compteur : numérotation continue, sans trou.
  Une facture émise est figée, ne peut pas être supprimée, seulement annulée (numéro conservé).
- **Conversion devis → facture** atomique : un double clic ne crée pas deux factures.
- **Paiements** partiels ou complets ; le statut « Payée » est recalculé automatiquement ; trop-perçu refusé.
- **RGPD** : un client sans document est supprimé ; un client avec devis/factures est
  **anonymisé** (données personnelles effacées, pièces comptables conservées).

## PDF (devis et factures)

- Gabarit dans `shared/pdf/render.ts`, fidèle au modèle de l'agence : logo `public/assets/pdf/logo.png`,
  polices Archivo Black et Space Grotesk (licence OFL, fichiers dans `public/assets/pdf/`).
- **Généré dans le navigateur**, pas sur le serveur : l'intégration des polices coûte ~450 ms de CPU,
  au-delà des 10 ms par requête de l'offre gratuite Cloudflare Workers. Le serveur ne fournit que les
  données (`GET /api/quotes/:id/pdf-data`, `/api/invoices/:id/pdf-data`).
- `npm run build` produit le moteur `public/js/vendor/pdf.js` (≈ 1,3 Mo, chargé au premier PDF puis mis en cache) ;
  ce fichier n'est pas versionné, Cloudflare Pages le reconstruit à chaque déploiement.
- Remplacer le logo : même nom de fichier, PNG ≈ 1530 × 315 px sur fond `#FAF6EF`.
- Conditions : une par ligne dans Paramètres, au format « Libellé : texte » (libellé en gras sur le PDF).

## Limites connues — à lire

1. **Facturation électronique (réforme française).** Les entreprises établies à Saint-Martin sont hors du champ
   de la réforme, la TVA n'y étant pas applicable ; un e-reporting reste possible pour des opérations situées en
   France et soumises à la TVA. Rien n'est donc implémenté (pas d'export Factur-X). À réévaluer si SDA facture un
   jour des entreprises de métropole ou des DROM.
   Sources : [impots.gouv.fr — FAQ DROM/COM](https://www.impots.gouv.fr/sites/default/files/media/1_metier/2_professionnel/EV/2_gestion/290_facturation_electronique/faq_drom.pdf),
   [fiche DOM-COM](https://www.impots.gouv.fr/sites/default/files/media/1_metier/2_professionnel/EV/2_gestion/290_facturation_electronique/fiches_reforme/fiche-domcom.pdf).
   Obligations éventuelles à Sint-Maarten : non vérifiées.
2. **Pas d'avoirs** : annuler une facture déjà envoyée devrait s'accompagner d'un avoir (non géré).
3. **Pas d'envoi d'email intégré** : le bouton prépare un email ; le PDF est à joindre à la main.
4. **Mentions légales** : les textes par défaut (pénalités de retard, indemnité de 40 €) viennent du droit
   commercial français ; leur application à Saint-Martin, et a fortiori à des clients de Sint-Maarten facturés
   en USD, est à faire valider par un expert-comptable.
5. **TGCA hors de Saint-Martin** : l'application de la TGCA aux prestations facturées à des clients de
   Sint-Maarten n'est pas tranchée dans l'outil — le taux se règle par client.

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
