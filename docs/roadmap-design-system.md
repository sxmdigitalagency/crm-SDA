# Roadmap : même design que le CRM pour les apps SDA

> Document destiné aux sessions Claude Code qui travaillent sur les dépôts SDA.
> Chaque phase contient un **prompt prêt à coller** dans une nouvelle session, sur le bon dépôt.
> Source de vérité visuelle : ce dépôt, `sxmdigitalagency/crm-SDA` (branche `main`).

---

## 1. Décisions prises

| Sujet | Décision |
|---|---|
| **Périmètre** | Apps SDA uniquement : `crm-SDA` (source), `crm-leads` (outil interne), `SXMDigitalAgency` (site vitrine). |
| **Hors périmètre** | Sites clients : `sxm-sunset-charter-site`, `rm-construction`, `site-duo-concept`, `maquette-ism`, `soma-sxm-nfc-page`. On n'y touche pas. |
| **Référence visuelle** | L'interface actuelle du CRM **telle quelle** : monde « Lagon ». Accent `#007580` (clair) / `#3cc2c7` (sombre), police Geist, verre sur les surfaces flottantes, fond vivant. |
| **Écart assumé** | Les **PDF** (devis, factures) et le logo gardent l'identité documentaire : Archivo Black / Space Grotesk, vert `#0E5E59` (`shared/pdf/render.ts`). Cet écart est volontaire : il ne faut pas « corriger » l'un d'après l'autre. |
| **Partage** | Un dépôt unique versionné : `sxmdigitalagency/sda-design-system` (public). |
| **Distribution** | Dépendance npm Git épinglée par tag, par exemple `github:sxmdigitalagency/sda-design-system#v1.0.0`, **copiée au build** dans `public/vendor/sda/`. Aucun chargement depuis un domaine tiers au moment de l'exécution. |

---

## 2. Règles non négociables (toutes phases, tous dépôts)

1. **Ne toucher à aucun dépôt client** (liste ci-dessus).
2. **Aucune modification fonctionnelle ni de contenu** : pas de texte réécrit, pas de route, d'API, de schéma ou de logique métier modifiés. Seuls le style, le balisage de présentation et l'intégration du design system changent.
3. **Une branche + une pull request par dépôt.** Jamais de push direct sur `main`. Nom de branche : `design-system/<phase>`.
4. **Captures avant/après** de chaque écran touché : thème clair, thème sombre, et largeur 390 px (mobile). Elles sont jointes à la PR ou au moins listées dans sa description.
5. **Qualité** : si l'outil `impeccable` est disponible, lancer `impeccable detect` ; appliquer les règles `web-design-guidelines` si la skill est installée. S'ils sont absents, le dire dans la PR, sans l'inventer. Vérifier les contrastes **AA** (4,5:1 texte, 3:1 éléments d'interface) dans les deux thèmes.
6. **Accessibilité du mouvement et de la matière** : respecter `prefers-reduced-motion` et `prefers-reduced-transparency`, comme le CRM (`public/css/app.css`, fin de fichier). Garder aussi la règle `forced-colors`.
7. **Pas de CDN tiers à l'exécution** : polices et CSS sont auto-hébergés (cohérence RGPD, pas d'appel à Google Fonts, jsDelivr, unpkg…).
8. **Version épinglée** du design system (tag semver), jamais une branche mouvante.
9. **Le verre est réservé aux surfaces flottantes** (navigation, en-têtes flottants, barres d'outils, dialogues, menus). Le contenu dense (chiffres, tableaux, formulaires) utilise `.glass-panel`, plus opaque, ou une surface pleine. Ne jamais empiler du verre sur du verre.
10. **Couleur jamais seule** pour porter une information : un statut a toujours un libellé (voir `.badge` dans le CRM).

---

## 3. Inventaire de la source (`crm-SDA`)

Fichiers réels à la date de rédaction, qui alimentent la phase 1 :

| Fichier | Contenu | Destination dans le design system |
|---|---|---|
| `public/css/tokens.css` | `@font-face` Geist, tokens clair/sombre (`prefers-color-scheme` + `[data-theme]`), espacement 4 px (`--s-1`…`--s-10`), rayons, échelle typo, mouvement, fond vivant (`--blob-*`), verre, encre, accent, statuts, séries dataviz (`--series-1/2`, `--grid`) | `tokens.css` (tel quel, chemin de police rendu relatif) |
| `public/css/app.css` | Base, fond vivant `.backdrop`, matières `.glass-*`, coquille `.shell` + `.sidebar` + `.nav` + `.nav-lens`, `.theme-switch`, en-tête de page, panneaux, boutons, champs, tableaux `.data`, `.badge`, états vides/squelettes, toasts, dialogues, grilles, responsive, mouvement réduit, transparence réduite, forced-colors | `components.css` (**tout le fichier est générique**) |
| `public/css/views.css` | Bandeau KPI `.pulse`, `.delta`, graphiques `.chart`/`.trend`/`.legend`, `.list-foot`, formulaires (`.form-panel`, `.form-actions`, `.check`, `.hint`…) | `components.css` : sections « Tableau de bord » (hors mise en page propre au CRM), « Listes », « Formulaires » |
| `public/css/views.css` | « Éditeur de document », « Catalogue », lignes de devis, paiements | **Reste dans le CRM** (spécifique métier) |
| `public/js/icons.js` + `scripts/build-icons.mjs` | Icônes Lucide (ISC) générées depuis `lucide-static`, liste `NAMES` | `js/icons.js` + `scripts/build-icons.mjs` (liste d'icônes extensible par l'app) |
| `public/js/ui.js` | Génériques : `esc`, `raw`, `html`, `ico`, `mount`, `toast`, `toastError`, `confirmDialog`, `busy`, `errorState`, `skeletonRows`, `bindRowLinks`, `debounce` | `js/ui.js` |
| `public/js/ui.js` | Métier : `quoteStatus`, `invoiceStatus`, `clientStatus`, `clientName` | **Reste dans le CRM** |
| `public/js/charts.js` | `lineChart`, `barList`, `countUp` | `js/charts.js` |
| `public/js/format.js` | Formatage fr-FR : `money`, `money0`, `moneyCompact`, `date`, `month`, `pct`, `timeAgo`… | `js/format.js` |
| `public/js/app.js` (l. 58–71) + script inline de `public/index.html` | Thème : clé `localStorage` `sda-theme` (`light`/`dark`, absent = système), attribut `data-theme` sur `<html>`, événement `themechange`, application avant rendu (anti-flash) | `js/theme.js` + extrait `theme-boot.html` documenté |
| `public/js/app.js` (l. 38–53) | Positionnement de la lentille de navigation `.nav-lens` | `js/nav-lens.js` (générique : prend un conteneur `.nav`) |
| `public/assets/fonts/Geist-Variable.woff2` + `Geist-LICENSE.txt` | Police Geist (OFL) | `fonts/` |
| `public/assets/favicon.svg` | Favicon | `brand/favicon.svg` |

Points d'attention constatés :
- La `@font-face` utilise un chemin **absolu** `/assets/fonts/Geist-Variable.woff2`. Dans le package, il faut un chemin relatif à `tokens.css` (`./fonts/…`) pour fonctionner une fois copié dans `public/vendor/sda/`.
- `.brand-mark` contient des couleurs codées en dur (`#0b7f86` → `#00545c`). Il faut les exposer en tokens (`--brand-grad-1/2`).
- **`crm-SDA` n'a aucune suite de tests** aujourd'hui (`package.json` : pas de script `test`). La non-régression de la phase 2 repose donc sur un script de captures à créer.

---

## 4. Phases

Ordre obligatoire : 0 → 1 → 2 → 3 → 4 → 5. Les phases 3 et 4 peuvent se faire en parallèle une fois la phase 2 fusionnée.

### Phase 0 : Audit (chaque dépôt cible)

**But** : savoir ce qu'on migre avant d'écrire du code. `crm-leads` et `SXMDigitalAgency` ont des stacks non documentées ici.

**Prompt à coller** (une session par dépôt : `crm-leads`, puis `SXMDigitalAgency`) :

```text
Contexte : SDA harmonise le design de ses apps internes sur celui du CRM (dépôt sxmdigitalagency/crm-SDA,
monde « Lagon » : Geist, accent #007580 / #3cc2c7, verre sur les surfaces flottantes, fond vivant).
Lis d'abord https://github.com/sxmdigitalagency/crm-SDA/blob/main/docs/roadmap-design-system.md
(sections 1 à 3) et public/css/tokens.css + public/css/app.css de crm-SDA.

Mission : AUDIT UNIQUEMENT de ce dépôt. Tu ne modifies aucun fichier de code.
Produis docs/audit-design-system.md, en français, contenant :
1. Stack : framework, gestionnaire de paquets, commande de build, répertoire de sortie, hébergement
   (Cloudflare Pages ? autre ?), version de Node attendue.
2. Liste des pages / écrans avec leur route.
3. CSS existant : fichiers, méthode (CSS pur, Tailwind, modules…), variables déjà présentes,
   polices et leur provenance (auto-hébergées ou CDN).
4. Écarts avec le CRM : couleurs, typo, rayons, espacements, composants (boutons, champs, tableaux,
   navigation), thème sombre présent ou non, mouvement réduit géré ou non.
5. Chargements tiers à l'exécution (CDN, polices Google, scripts) : liste exhaustive.
6. Plan de migration écrit : quels fichiers changent, dans quel ordre, ce qui est hors périmètre,
   risques. Aucun code.

Règles : aucune modification fonctionnelle ni de contenu ; branche design-system/audit ; une PR
contenant uniquement docs/audit-design-system.md ; jamais de push sur main.
Critère d'acceptation : le plan permet à une autre session de faire la migration sans relire le code en entier.
```

**Critères d'acceptation** : `docs/audit-design-system.md` existe dans chaque dépôt cible, avec les 6 sections ; aucun autre fichier modifié.

**Vérifications** : `git diff --stat main` ne montre que le fichier d'audit ; la commande de build indiquée a été réellement exécutée.

---

### Phase 1 : Créer `sda-design-system` à partir de `crm-SDA`

**Prérequis humain** : créer le dépôt **public** `sxmdigitalagency/sda-design-system` sur GitHub (vide, sans README) si la session n'a pas le droit de le faire. Public, parce qu'il ne contient rien de secret et que Cloudflare Pages peut ainsi l'installer sans jeton.

**Prompt à coller** (session ouverte sur un clone vide de `sda-design-system`, avec `crm-SDA` cloné à côté) :

```text
Contexte : SDA crée son design system partagé à partir du CRM (sxmdigitalagency/crm-SDA, branche main).
Lis d'abord crm-SDA/docs/roadmap-design-system.md en entier ; la section 3 liste les fichiers source exacts.

Mission : initialiser le dépôt sxmdigitalagency/sda-design-system en COPIANT les fichiers réels du CRM
(ne redessine rien, ne « modernise » rien : le rendu doit être identique au CRM).

Structure attendue :
  tokens.css        ← crm-SDA/public/css/tokens.css ; chemin de police rendu relatif (./fonts/Geist-Variable.woff2) ;
                      ajouter --brand-grad-1 / --brand-grad-2 (couleurs actuelles de .brand-mark).
  components.css    ← tout crm-SDA/public/css/app.css + sections génériques de public/css/views.css
                      (Tableau de bord : .pulse, .delta, .chart, .trend, .legend ; Listes ; Formulaires).
                      NE PAS reprendre : Éditeur de document, Catalogue, lignes de devis, paiements.
                      Ordre et commentaires de sections conservés.
  js/icons.js, scripts/build-icons.mjs  ← versions du CRM ; le script accepte une liste d'icônes supplémentaires
                      passée par l'app (argument ou fichier), Lucide ISC, mention de licence conservée.
  js/ui.js          ← fonctions génériques de crm-SDA/public/js/ui.js (esc, raw, html, ico, mount, toast, toastError,
                      confirmDialog, busy, errorState, skeletonRows, bindRowLinks, debounce). PAS les statuts métier.
  js/charts.js      ← crm-SDA/public/js/charts.js
  js/format.js      ← crm-SDA/public/js/format.js
  js/theme.js       ← logique de thème de crm-SDA/public/js/app.js (clé localStorage « sda-theme », data-theme,
                      événement themechange, rendu du .theme-switch) ; + snippets/theme-boot.html (script inline anti-flash
                      repris de crm-SDA/public/index.html).
  js/nav-lens.js    ← positionnement de .nav-lens extrait de crm-SDA/public/js/app.js, rendu générique.
  fonts/            ← Geist-Variable.woff2 + Geist-LICENSE.txt (OFL)
  brand/favicon.svg ← crm-SDA/public/assets/favicon.svg
  DESIGN.md         ← principes (Lagon, verre réservé aux surfaces flottantes, couleur jamais seule, mouvement sobre),
                      table des tokens, catalogue des composants avec extrait HTML, do / don't,
                      écart assumé avec les PDF (Archivo Black / Space Grotesk / #0E5E59) expliqué.
  demo/index.html   ← vitrine de TOUS les composants, bascule clair / sombre / système, sans aucune ressource tierce.
  package.json      ← name "@sda/design-system", version 1.0.0, "files" explicites, script "build:icons",
                      "exports" vers les CSS/JS ; aucune dépendance d'exécution.
  CHANGELOG.md      ← entrée 1.0.0.
  README.md         ← installation (dépendance Git épinglée + copie vers public/vendor/sda/ au build), mise à jour.

Règles : aucun secret ; aucun CDN ; pas de framework ; contrastes AA vérifiés dans les deux thèmes pour les paires
encre/fond et accent/fond ; prefers-reduced-motion, prefers-reduced-transparency et forced-colors conservés.
Travaille sur la branche design-system/init, ouvre une PR. Après fusion (par l'humain), pose le tag v1.0.0.

Critères d'acceptation :
- demo/index.html ouvert en local reproduit le rendu du CRM (captures clair, sombre, 390 px jointes à la PR) ;
- diff entre tokens.css du package et celui du CRM limité au chemin de police et aux tokens --brand-grad-* ;
- `grep -rE "https?://" tokens.css components.css js/` ne renvoie que des URL de licence en commentaire.
```

**Critères d'acceptation** : dépôt public, tag `v1.0.0` posé, `demo/index.html` fidèle au CRM, `DESIGN.md` complet.

**Vérifications** : `git ls-remote --tags https://github.com/sxmdigitalagency/sda-design-system.git` affiche `v1.0.0` ; `npm pack --dry-run` liste bien fonts, CSS, JS, DESIGN.md.

---

### Phase 2 : Rebrancher `crm-SDA` sur le package

**Prompt à coller** (session sur `crm-SDA`) :

```text
Contexte : le design system sxmdigitalagency/sda-design-system (tag v1.0.0) a été extrait de CE dépôt.
Lis docs/roadmap-design-system.md (sections 2 et 3) et le README / DESIGN.md du design system.

Mission : faire consommer le package par le CRM, avec ZÉRO régression visuelle.
1. AVANT tout changement : crée scripts/screenshots.mjs (Playwright en devDependency) qui, avec `npm run dev`
   et les données de démo (`npm run db:seed:local`), capture chaque écran (tableau de bord, clients, fiche client,
   formulaire client, devis, factures, document, prestations, réglages, login) en clair, sombre et 390 px.
   Il n'existe aujourd'hui AUCUNE suite de tests : ce script est le filet de sécurité. Génère les captures de référence.
2. Ajoute la dépendance "@sda/design-system": "github:sxmdigitalagency/sda-design-system#v1.0.0".
3. Étends le script "build" pour copier node_modules/@sda/design-system/{tokens.css,components.css,js,fonts,brand}
   vers public/vendor/sda/ (script Node sans dépendance ; public/vendor/sda/ ajouté au .gitignore si pertinent,
   en vérifiant que Cloudflare Pages exécute bien `npm run build`).
4. Remplace dans public/index.html et public/login/index.html : tokens.css + app.css → /vendor/sda/tokens.css +
   /vendor/sda/components.css ; favicon et préchargement de police vers /vendor/sda/.
   views.css ne garde que le spécifique CRM (éditeur de document, catalogue, lignes, paiements).
5. public/js/ui.js ré-exporte les génériques depuis /vendor/sda/js/ui.js et garde les statuts métier ;
   charts.js, format.js, icons.js, thème et lentille de nav importés depuis /vendor/sda/js/.
6. Supprime les doublons devenus inutiles (public/css/tokens.css, public/assets/fonts/…) seulement quand plus rien
   ne les référence (`grep -rn`).
7. Relance scripts/screenshots.mjs et compare pixel à pixel aux références ; tout écart est corrigé ou expliqué
   dans la PR.

Règles : aucune modification fonctionnelle ni de contenu ; les PDF (shared/pdf/) ne changent pas ;
branche design-system/crm, PR, jamais de push sur main ; `npm run typecheck` et `npm run build` passent.
```

**Critères d'acceptation** : captures identiques (ou écarts justifiés un par un) ; `npm run build` et `npm run typecheck` verts ; aucun fichier de `shared/pdf/` ni `functions/` modifié ; le déploiement d'aperçu Cloudflare installe bien la dépendance Git.

**Vérifications** : `git diff --stat main -- functions shared migrations` vide ; onglet Réseau du navigateur : aucune requête hors du domaine.

---

### Phase 3 : `crm-leads` (mode « Operate », comme le CRM)

**Prompt à coller** (session sur `crm-leads`) :

```text
Contexte : SDA aligne ses apps sur le design du CRM via le package sxmdigitalagency/sda-design-system
(tag épinglé, voir son DESIGN.md). Lis https://github.com/sxmdigitalagency/crm-SDA/blob/main/docs/roadmap-design-system.md
(sections 2 et 4 / Phase 3) et docs/audit-design-system.md de CE dépôt (produit en phase 0) : suis son plan.

Mission : donner à crm-leads l'apparence et le comportement visuel du CRM, fonctionnalités inchangées.
- Dépendance Git épinglée au dernier tag du design system, copiée au build dans public/vendor/sda/ (ou l'équivalent
  du répertoire statique de la stack) ; aucun CDN.
- Coquille : .shell + .sidebar (glass-float) + .nav avec .nav-lens, barre du bas sous 900 px, .theme-switch
  clair / sombre / système (clé localStorage « sda-theme », script anti-flash dans <head>).
- Fond vivant .backdrop, panneaux .glass-panel pour le contenu, tableaux .data, badges avec libellé,
  formulaires (.field, .form-grid, .form-actions), états vides / squelettes, toasts, dialogues de confirmation.
- Tableau de bord : bandeau .pulse et graphiques du package si l'app affiche des indicateurs.
- Si la stack utilise un framework (React, etc.), consomme les CSS du package et reproduis le balisage documenté
  dans DESIGN.md ; n'invente pas de nouveaux composants : tout composant manquant est proposé dans le design system
  (issue ou PR là-bas), pas créé localement.

Règles : docs/roadmap-design-system.md section 2 (aucune modif fonctionnelle ni de contenu, branche
design-system/adoption + PR, captures avant/après clair/sombre/390 px, AA, reduced-motion/transparency, pas de CDN).
```

**Critères d'acceptation** : tous les écrans listés dans l'audit suivent le CRM ; parcours principaux (liste, fiche, création, modification, suppression avec confirmation) testés à la main et décrits dans la PR ; aucune requête tierce.

**Vérifications** : captures avant/après jointes ; build de production OK ; comparaison côte à côte avec le CRM sur un écran liste et un écran formulaire.

---

### Phase 4 : `SXMDigitalAgency` (site vitrine, mode « Persuade »)

**Prompt à coller** (session sur `SXMDigitalAgency`) :

```text
Contexte : le site vitrine de SDA adopte l'IDENTITÉ du CRM, pas sa structure d'application.
Lis https://github.com/sxmdigitalagency/crm-SDA/blob/main/docs/roadmap-design-system.md (sections 2 et 4 / Phase 4),
le DESIGN.md du package sxmdigitalagency/sda-design-system et docs/audit-design-system.md de CE dépôt.

Mission :
- Mesure AVANT : Lighthouse mobile (performance, accessibilité, bonnes pratiques, SEO) sur l'accueil et une page
  intérieure ; note les scores et le poids des polices.
- Adopte tokens.css (couleurs, typo Geist auto-hébergée, rayons, espacements, mouvement) et les boutons / champs
  de components.css. Retire les polices ou CSS chargés depuis un CDN.
- Verre (.glass-float) UNIQUEMENT pour l'en-tête flottant ; fond vivant (.backdrop) UNIQUEMENT dans le hero.
- PAS de coquille de tableau de bord (.shell, .sidebar, .nav-lens) : c'est un site, pas une app.
- Contenu, textes, balises meta, données structurées, URLs, images : inchangés.
- Police : un seul fichier Geist variable en woff2, préchargé ; font-display: swap.
- Mesure APRÈS avec les mêmes pages et conditions.

Règles : section 2 de la roadmap. Critère bloquant : aucun score Lighthouse ne baisse de plus de 3 points,
SEO et accessibilité ne baissent pas du tout. Branche design-system/adoption, PR avec tableau avant/après.
```

**Critères d'acceptation** : identité Lagon visible (en-tête, boutons, typo, hero) ; tableau Lighthouse avant/après dans la PR, contraintes respectées ; aucun texte ni balise SEO modifié (`git diff` sur le contenu vide).

**Vérifications** : test sur mobile réel ou émulé modeste (verre et fond vivant fluides, sinon repli sur `.glass-solid`) ; aucune requête tierce.

---

### Phase 5 : Gouvernance

**Prompt à coller** (session sur `sda-design-system`, puis une courte PR par dépôt SDA) :

```text
Contexte : les apps SDA (crm-SDA, crm-leads, SXMDigitalAgency) consomment sxmdigitalagency/sda-design-system.
Lis https://github.com/sxmdigitalagency/crm-SDA/blob/main/docs/roadmap-design-system.md (Phase 5).

Mission :
1. Dans sda-design-system : CONTRIBUTING.md avec semver (MAJOR = rupture de classes ou tokens renommés/supprimés,
   MINOR = nouveau composant ou token, PATCH = correction), CHANGELOG obligatoire à chaque version, tag git à chaque
   version, captures de demo/index.html (clair/sombre/390 px) dans chaque PR.
2. Procédure « mettre à jour une app » dans le README : changer le tag dans package.json, npm install, build,
   captures avant/après, PR.
3. Dans CHAQUE dépôt SDA (crm-SDA, crm-leads, SXMDigitalAgency) : ajouter ou compléter CLAUDE.md avec une section
   « Design » qui pointe vers le DESIGN.md du design system (URL GitHub), rappelle la version épinglée et la règle :
   « Tout nouveau composant naît dans le design system, jamais localement dans une app. »
   Une PR par dépôt, aucun autre changement.
```

**Critères d'acceptation** : `CONTRIBUTING.md` présent ; chaque dépôt SDA a un `CLAUDE.md` pointant vers `DESIGN.md` ; procédure de mise à jour testée une fois (passage à un tag PATCH factice ou réel).

---

## 5. Risques

| Risque | Impact | Parade |
|---|---|---|
| Écart UI (Geist, Lagon `#007580`) vs PDF / logo (Archivo Black, Space Grotesk, `#0E5E59`) | Incohérence perçue entre l'app et les documents envoyés | Écart **assumé et documenté** dans `DESIGN.md` ; on ne l'« aligne » pas en douce. Une éventuelle unification sera une décision séparée. |
| Coût de `backdrop-filter` (flou 26 px) sur mobiles modestes | Défilement saccadé, batterie | Verre limité aux surfaces flottantes ; repli `prefers-reduced-transparency` déjà prévu ; tester sur appareil modeste en phase 4 ; possibilité d'un token de flou réduit sous 900 px. |
| Poids des polices sur le site vitrine | LCP, score Lighthouse | Un seul woff2 variable, préchargé, `font-display: swap` ; critère bloquant Lighthouse en phase 4. |
| Stacks inconnues de `crm-leads` et `SXMDigitalAgency` | Intégration plus lourde que prévu (framework, CSS utilitaire) | Phase 0 obligatoire avant tout code ; le package reste en CSS/JS natif, consommable par n'importe quelle stack. |
| Dépôt du design system public | Le design est visible de tous | Acceptable : il est déjà public via les sites en ligne ; aucun secret ni donnée dans le dépôt. |
| `crm-SDA` sans tests | Régression visuelle non détectée en phase 2 | Script de captures créé **avant** toute modification (phase 2, étape 1). |
| Dépendance Git lors du build Cloudflare Pages | Échec d'installation si le dépôt devient privé ou si le tag disparaît | Dépôt public, tags jamais supprimés ni déplacés. |

---

## 6. Suivi

| Phase | Dépôt | Statut |
|---|---|---|
| 0 | `crm-leads` | À faire |
| 0 | `SXMDigitalAgency` | À faire |
| 1 | `sda-design-system` | À faire (dépôt à créer sur GitHub) |
| 2 | `crm-SDA` | À faire |
| 3 | `crm-leads` | À faire |
| 4 | `SXMDigitalAgency` | À faire |
| 5 | tous les dépôts SDA | À faire |
