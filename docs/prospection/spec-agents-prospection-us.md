# Spec — Système de prospection multi-agents (SDA, marché US)

Destinataire : Claude Code. Ce document est une instruction de build. Exécute-le phase par phase (section 9) et ne passe à la phase suivante qu'après validation de Mathys.

---

## 0. Hypothèses fixées (modifiables via config, pas en dur dans le code)

| Paramètre | Valeur de départ |
|---|---|
| Cible | Trois métiers, licence Floride : **climatisation / chauffage** (classe CAC, Certified Air Conditioning Contractor), **plomberie** (classe CFC, Certified Plumbing Contractor, code à confirmer, voir section 8) et **toiture** (classe CCC, Certified Roofing Contractor). Au départ, uniquement les licences « certified » (délivrées par l'État), pas les « registered » (locales). |
| Zone | Floride, en commençant par 3 comtés : Hillsborough, Orange, Duval |
| Offre testée | Agent IA qui répond / qualifie les demandes entrantes + tableau de bord de supervision relié à leurs outils |
| Canal de contact | Email froid uniquement, rédigé par agent, **envoyé seulement après validation humaine** |
| Langue des messages | Anglais américain |
| Décideur de la suite | Mathys (réponses humaines, aucun auto-reply) |

Ces valeurs vivent dans la table `prospect_config` (voir section 3) pour pouvoir changer de secteur, d'État ou de comtés sans toucher au code.

Pourquoi ces choix : le besoin « appel manqué = demande perdue » est le mieux documenté dans les services à domicile (climatisation, plomberie, toiture), mais les chiffres viennent surtout d'éditeurs d'outils. Le projet sert donc à tester l'hypothèse sur des données réelles de réponse, pas à la supposer vraie.

---

## 1. Règles non négociables (à coder, pas à « garder en tête »)

### 1.1 Email (CAN-SPAM)
Chaque email commercial doit : (a) avoir des en-têtes From/Reply-To honnêtes, (b) un objet non trompeur, (c) identifier le message comme une sollicitation commerciale, (d) contenir l'adresse postale de l'expéditeur, (e) contenir un mécanisme de désinscription fonctionnel, (f) honorer toute désinscription dans un délai de 10 jours ouvrés, ici **immédiatement**.
- Implémentation : lien de désinscription en un clic + mention « reply STOP » traitée par le classifieur de réponses. Toute désinscription écrit dans `suppression` et bloque tout envoi futur à ce domaine ET à cette adresse.
- Ne jamais : faux « Re: » ou « Fwd: » dans l'objet, fausse identité d'expéditeur, fausse urgence, fausse déclaration de résultats ou de clients.

### 1.2 Pas d'appels sortants automatisés, pas de SMS
Les voix générées par IA sont soumises au TCPA et exigent un consentement préalable. Aucun agent vocal sortant, aucun SMS/WhatsApp à froid. Le système ne contient aucun module d'appel sortant.

### 1.3 Sources de données
- **Interdit** : scraper Google Maps / Google Search, ou utiliser du contenu Google Maps pour constituer une base de prospects (CGU Google Maps Platform §3.2.3).
- **Autorisé** : (a) le fichier public des licenciés DBPR de Floride, (b) le site web de chaque entreprise, consulté poliment (voir 4.2), (c) une API de recherche dont les CGU autorisent l'usage programmatique. Vérifier les CGU avant d'intégrer ; exemple de candidat : Brave Search API. Ne pas utiliser de service qui revend du scraping Google.
- Ne jamais collecter ni utiliser une adresse personnelle/résidentielle : seuls l'email et le téléphone **publiés par l'entreprise sur son propre site** servent au contact. Le fichier DBPR peut contenir des adresses de personnes physiques : ne pas les utiliser pour contacter.

### 1.4 Honnêteté des messages
Aucun témoignage, aucun chiffre de résultat, aucune mention de client : Mathys n'a pas encore de preuve client publiable. Tout fait cité dans un message doit provenir de `evidence` (section 3) et être vérifiable sur la page source. Pas de « I noticed you…» générique : le fait observé doit être réel et cité.

### 1.5 Humain dans la boucle
Phase initiale : **aucun envoi sans approbation individuelle** dans le CRM. L'auto-envoi n'est un sujet qu'après 100 emails approuvés sans correction majeure, et seulement sur décision explicite de Mathys.

---

## 2. Architecture

Stack : Cloudflare Workers + D1 + Queues + Cron Triggers. Le CRM de Mathys (D1) est la source de vérité et l'interface de supervision. Un agent = un Worker avec une seule responsabilité, qui communique par la table `jobs` et des Queues.

| Worker | Rôle | LLM ? |
|---|---|---|
| `discover` | Importer le fichier DBPR, filtrer CAC / actif / comtés ciblés, créer les `companies` | Non |
| `enrich` | Trouver le site web, le crawler, extraire les faits | Non pour le crawl ; extraction de faits par règles |
| `qualify` | Calculer le score et rédiger la justification | Oui (lecture des preuves uniquement) |
| `draft` | Rédiger l'email à partir des faits validés | Oui (brief serré) |
| `send` | Envoyer dans les limites de cadence, gérer les suppressions | Non |
| `inbox` | Classifier les réponses, déclencher les désinscriptions, notifier Mathys | Oui (classification) |
| `supervisor` | Métriques, alertes, arrêts automatiques | Non |

Règles transverses :
- Le nom du modèle LLM vient d'une variable d'environnement (`LLM_MODEL`), jamais en dur. Choisir le plus petit modèle suffisant par tâche.
- Chaque appel LLM écrit sa consommation (tokens, coût estimé) dans `llm_usage`.
- Chaque Worker est idempotent : relancer le même job ne crée pas de doublon.
- Les sorties LLM sont du JSON validé par un schéma ; si invalide, le job passe en `failed` après 2 essais, il ne devine jamais.

---

## 3. Schéma D1 (tel que créé par `migrations/0005_prospection.sql`)

Toutes les tables sont préfixées `prospect_` (aucune collision avec les tables du CRM). Elles vivent dans la base
D1 `crm-sda`, source de vérité. La migration fait foi ; ce résumé dit la même chose. Ailleurs dans ce document,
`config`, `companies`, `contacts`, `evidence`, `qualifications`, `messages`, `suppression`, `jobs` et `llm_usage`
désignent ces tables préfixées.

| Table | Rôle | Contraintes ajoutées par rapport à la version initiale |
|---|---|---|
| `prospect_config` | `key` / `value` (+ `updated_at`) : toutes les hypothèses de la section 0, 4 et 7 | — |
| `prospect_companies` | une ligne par `license_number` ; `license_class`, `trade`, noms, ville, comté, État, statut et expiration de licence, `website_url`, `website_checked_at`, `stage` | `trade` ∈ hvac / plumbing / roofing ; `stage` ∈ liste de la spec (CHECK) ; ajout de `website_domain` (dédoublonnage 4.1.2), `duplicate_of` (licence rattachée à l'entreprise conservée), `rejected_reason`, `updated_at` |
| `prospect_contacts` | email ou téléphone publié par l'entreprise, `source_url` obligatoire, `kind` (generic / named), vérification | au moins un email ou un téléphone ; unique (`company_id`, `email`) ; unique (`company_id`, `phone`) quand pas d'email |
| `prospect_evidence` | un fait observé : `signal`, `value`, `source_url`, `excerpt` | unique (`company_id`, `signal`, `source_url`) ; `excerpt` ≤ 200 caractères (CHECK) |
| `prospect_qualifications` | score, `tier`, `breakdown_json`, `rationale`, `rubric_version` | `tier` ∈ ready / review / reject ; unique (`company_id`, `rubric_version`) ; ajout de `best_evidence_id` (référence obligatoire à une preuve existante), `red_flags_json`, `reviewer_verdict` (agree / disagree, revue 4.3) |
| `prospect_messages` | emails sortants et réponses : objet, corps, `status`, `evidence_ids`, `classification` | `direction`, `status`, `classification` en CHECK ; `step` 0 à 2 ; un seul message sortant actif par (`company_id`, `step`) ; statut `received` pour les réponses ; ajout de `provider_message_id` (unique), `in_reply_to`, `thread_key` (rattachement fiable des réponses par `inbox`), `reject_reason`, `created_at` |
| `prospect_suppression` | désinscriptions : `kind` (email / domain), `value`, `reason` | remplace `UNIQUE(email, domain)`, qui laissait passer des doublons (SQLite traite les NULL comme distincts) : une ligne par adresse ou par domaine, unique (`kind`, `value`), valeur en minuscules (CHECK) |
| `prospect_jobs` | une tâche par étape : `worker`, `company_id`, `status`, `attempts`, `error` | ajout de `idem_key`, unique (`worker`, `idem_key`) : relancer un job ne crée pas de doublon ; `status` ∈ queued / running / done / failed ; `started_at` |
| `prospect_llm_usage` | consommation par appel LLM | ajout de `job_id` |
| `prospect_log` | journal : niveau, étape, job, message, contexte JSON | table ajoutée (journalisation de la phase 0) |

Toutes les clés étrangères pointent vers `prospect_companies`, `prospect_contacts`, `prospect_evidence` ou `prospect_jobs`.

---

## 4. Pipeline détaillé

### 4.1 `discover`
1. Trouver sur le site officiel du DBPR (myfloridalicense.com) la page « Licensee Download Files » et télécharger le fichier des licenciés de construction. Ne pas coder en dur l'URL sans l'avoir vérifiée. Le fichier est un fichier plat sans en-tête ; lire la documentation de format publiée à côté et mapper les colonnes à partir de cette documentation, pas par supposition.
2. Filtrer : occupation dans `target_license_classes` (CAC, CFC, CCC), statut actif, comté dans `target_counties`. Renseigner `companies.trade` (`hvac`, `plumbing` ou `roofing`) d'après la classe, avec un mapping classe → métier stocké en config. Une même entreprise peut détenir plusieurs classes : garder une ligne par `license_number`, mais **dédoublonner par domaine de site web avant tout contact** (une entreprise = un seul email, même avec deux licences ; conserver la première licence et noter les autres dans `evidence`).
3. Insérer dans `companies` (clé unique `license_number`). Re-exécutable chaque semaine sans doublon.
4. Critère d'acceptation : le nombre de lignes importées est affiché et comparé à un comptage indépendant du même filtre sur le fichier brut.

### 4.2 `enrich`
1. Trouver le site web : API de recherche autorisée (voir 1.3) avec la requête `"<dba_name or legal_name>" <city> FL`. Accepter un résultat seulement si le domaine contient le nom ou si la page cite la ville et la licence ; sinon `website_url = NULL` et l'entreprise passe en `rejected` (raison : `no_website_found`).
2. Crawler poliment : lire `robots.txt` et le respecter ; User-Agent identifiable (`SDA-Research-Bot/1.0 (+https://sxmdigitalagency.com)`) ; 1 requête / 2 s par domaine ; maximum 6 pages (accueil, /contact, /about, /services, /schedule*, /book*) ; timeout 10 s.
3. Extraire, par règles (regex / sélecteurs), et enregistrer dans `evidence` avec `source_url` :
   - `phone_present`, `phone_value`
   - `emails_public` (mailto: ou texte visible sur la page) → `contacts`
   - `has_contact_form` (oui/non)
   - `has_online_booking` (widget/lien de réservation connu : Calendly, ServiceTitan scheduler, Housecall Pro, Jobber, Acuity, formulaire « schedule service »)
   - `has_chat_widget` (domaines de widgets de chat connus)
   - `mentions_24_7_or_emergency` (texte « 24/7 », « emergency », « same day »)
   - `has_ads_tracking` (balise Google Ads `AW-XXXXXXXX` ou pixel Meta dans le HTML) — signal qu'ils paient pour des demandes
   - `has_ai_answering_signal` (domaines/mentions d'un service de réponse IA ou d'un standard externe, liste en config, éditable)
   - `team_size_hint` (mentions « our team », nombre de techniciens/camions cités)
   - `locations_count` (pour écarter les chaînes nationales)
4. Vérifier chaque email trouvé (syntaxe + enregistrement MX + vérification SMTP douce) avant de le marquer envoyable. Un email non vérifié n'est jamais utilisé.
5. Critère d'acceptation : sur 30 entreprises tirées au hasard, Mathys vérifie à la main que chaque ligne d'`evidence` est correcte via son `source_url`. Taux d'erreur toléré : 10 %. Au-dessus, corriger avant de continuer.

### 4.3 `qualify` — la partie qui compte le plus
Deux étages, dans cet ordre :

**Étage 1 — scoring déterministe** (aucun LLM, reproductible), à partir de `evidence` :

| Critère | Points |
|---|---|
| Aucun widget de réservation ET aucun chat | +20 |
| Contact par téléphone uniquement (pas de formulaire) | +15 |
| Pas de mention 24/7 / urgence | +10 |
| Balise publicitaire détectée (ils paient pour des demandes) | +20 |
| Indice d'équipe 3 à 25 personnes (au moins 3 techniciens/camions cités) | +15 |
| Zone de service sur plusieurs villes | +5 |
| Email public vérifié disponible | +15 |
| Signal de service de réponse IA/standard déjà en place | −40 |
| Chaîne / plus de 3 établissements | exclu (rejected) |
| Aucun email public ET aucun formulaire | exclu |
| Licence expirée ou suspendue | exclu |

Seuils initiaux : **≥ 60 = `ready`**, **40–59 = `review`** (Mathys décide), **< 40 = `reject`**. Ces poids sont une hypothèse de départ, versionnée dans `rubric_version`, à recalibrer d'après les réponses reçues (voir section 7).

**Étage 2 — lecture par LLM, uniquement pour les cas `ready` et `review`** : il reçoit les lignes d'`evidence` (jamais le web brut) et produit un JSON : `{ "rationale": "...", "best_observed_fact_id": <evidence.id>, "red_flags": [...] }`. Il ne peut pas inventer de fait : `best_observed_fact_id` doit référencer une ligne existante, sinon la sortie est rejetée.

Critère d'acceptation : Mathys relit les 50 premiers scores `ready`/`review` et marque chacun « d'accord / pas d'accord ». Si plus de 20 % sont contestés, on corrige la grille avant de passer au contact.

### 4.4 `draft`
Entrée : l'entreprise, le fait observé choisi (une ligne d'`evidence`), le contact. Sortie : objet + corps, en anglais.
Contraintes de rédaction (à mettre dans le prompt système et à valider par du code, pas seulement par le prompt) :
- Corps ≤ 90 mots, une seule demande (une réponse courte), ton d'égal à égal, pas de jargon IA.
- Adapter le vocabulaire au métier (`companies.trade`) : HVAC, plumbing ou roofing. Le message peut évoquer une demande urgente typique du métier (panne de clim, fuite, toiture abîmée), mais jamais s'appuyer sur un sinistre réel ou une urgence réelle d'un client, ni inventer de contexte.
- Structure : 1 phrase sur le fait observé précis et vérifiable → 1 phrase sur ce qu'on propose (agent qui répond/qualifie les demandes + tableau de bord de suivi) → 1 question simple.
- Interdits vérifiés par code : chiffres de résultats, noms de clients, superlatifs (« best », « guaranteed »), urgence artificielle, fausse familiarité, « Re: », liens suivis (pas de tracking pixel).
- Pied de message obligatoire : nom (Mathys), SXM Digital Agency, adresse postale (config `postal_address`), mention de désinscription.
- Le code refuse un brouillon qui contient un nombre non présent dans `evidence`, ou qui dépasse 90 mots.
- Statut final : `pending_approval`.

### 4.5 `send`
- Seulement les messages `approved`, jamais d'envoi direct par `draft`.
- Avant chaque envoi : vérifier `suppression` (email ET domaine), vérifier que l'entreprise est toujours en `ready`, vérifier la cadence.
- Cadence initiale : 5 envois/jour la 1re semaine, puis +5/jour par semaine tant que rebond < 2 % et plaintes < 0,3 %, plafond de départ 30/jour. Envoi seulement en heures ouvrées locales de la Floride (heure de l'Est), lundi–jeudi.
- Relances : au plus 2, à J+4 et J+9, arrêtées dès réponse, désinscription ou rebond.
- Arrêt automatique de tous les envois (`supervisor`) si rebond > 2 % ou plaintes > 0,3 % sur les 100 derniers envois.
- Infrastructure : domaine d'envoi **séparé** de sxmdigitalagency.com, SPF + DKIM + DMARC configurés, montée en charge progressive. Le fournisseur d'envoi est à choisir avec Mathys : vérifier que ses CGU autorisent l'email commercial non sollicité (beaucoup de services transactionnels l'interdisent). Ne pas intégrer un fournisseur sans cette vérification.

### 4.6 `inbox`
- Récupérer les réponses, rattacher au `message` d'origine, classifier : `interested | not_interested | unsubscribe | ooo | question | other`.
- `unsubscribe` ou toute demande d'arrêt : écrire dans `suppression` immédiatement, mettre `stage='suppressed'`, aucune autre action.
- `interested` / `question` : notifier Mathys (CRM + notification). **Aucune réponse automatique.**

### 4.7 `supervisor` — vue CRM
Tableau de bord (lecture sur D1) : entonnoir par semaine (découvertes → enrichies → qualifiées → brouillons → approuvés → envoyés → rebonds → réponses → réponses positives → rendez-vous), file d'approbation avec le message et ses preuves côte à côte, coût LLM cumulé par étape, taux par critère de scoring.

---

## 5. Ce que Claude Code NE doit PAS faire
- Scraper Google, Google Maps ou tout service dont les CGU l'interdisent.
- Envoyer le moindre email avant la phase 4 et sans approbation individuelle.
- Rédiger ou envoyer à des particuliers ; utiliser des adresses personnelles du fichier DBPR.
- Inventer une preuve, un client, un chiffre.
- Écrire un module d'appel sortant, de SMS ou de WhatsApp.
- Choisir seul le fournisseur d'envoi ou de recherche : proposer 2 options avec leurs CGU et attendre Mathys.

---

## 6. À fournir par Mathys avant la phase 4
1. Un domaine d'envoi dédié + une boîte mail dessus.
2. Une adresse postale à mettre dans les emails. Point ouvert : je ne sais pas si une boîte postale française à Saint-Martin satisfait l'exigence d'adresse postale valide de CAN-SPAM ; à vérifier dans le guide de la FTC avant le premier envoi.
3. Le fournisseur d'envoi retenu, après vérification des CGU.

---

## 7. Mesure et critères d'arrêt (fixés maintenant, pas après)
Initiaux, à ajuster seulement par décision écrite de Mathys :
- **Phase de test = 150 emails envoyés au total**, répartis à parts à peu près égales entre les trois métiers (environ 50 chacun). Les résultats sont analysés **par métier** : un total correct peut cacher un métier qui ne répond pas. À 50 envois par métier, les écarts sont des indices, pas des preuves.
- Si à 150 envois : 0 réponse positive → on arrête et on révise le segment ou le message avant de continuer.
- Si un métier a 0 réponse positive à 50 envois alors qu'un autre en a, on met ce métier en pause sans arrêter les autres.
- Mesurer : coût LLM + coûts d'outils par réponse positive, par rendez-vous, par client.
- Recalibrage de la grille : après chaque lot de 50 envois, comparer le score moyen des entreprises qui ont répondu positivement à celui des autres ; ajuster les poids en versionnant `rubric_version`.
- Cadre de l'objectif business : il s'agit de savoir si ce canal rapporte, pas d'atteindre un volume.

---

## 8. Points à vérifier (je ne les ai pas confirmés)
- Les règles floridiennes sur la sollicitation commerciale (appels/SMS) ne sont pas couvertes ici ; ce système est email-only, mais à relire avant d'ajouter tout canal.
- La conformité de la collecte d'emails sur les sites web d'entreprises selon les lois d'État : couverte pour des emails d'entreprise publiés par l'entreprise elle-même, mais Mathys doit faire valider ce point avant de passer à grande échelle.
- Les CGU des fournisseurs de recherche et d'envoi (section 4.2 et 4.5).
- Le format exact du fichier DBPR (lu dans sa documentation officielle, pas supposé).
- Les codes de classe de licence : CAC (climatisation) et CCC (toiture) apparaissent dans des sources publiques que j'ai consultées ; CFC (plomberie) vient de ma connaissance et n'est pas vérifié ici. Claude Code doit lire la table officielle des codes dans la documentation du DBPR avant l'import, et corriger le mapping classe → métier si le code de plomberie diffère.

---

## 9. Ordre de build (une phase à la fois, validation Mathys entre chaque)

**Phase 0 — Fondations.** Migration D1 (section 3), table `config`, variables d'environnement, journalisation. Acceptation : migration appliquée, tables vides vérifiées.

**Phase 1 — `discover` + `enrich` (aucun email, aucun LLM).** Import DBPR, recherche de site, crawl poli, extraction des preuves. Acceptation : contrôle manuel de 30 entreprises (4.2.5).

**Phase 2 — `qualify`.** Scoring déterministe puis étage LLM. Acceptation : revue des 50 premiers scores par Mathys (4.3).

**Phase 3 — `draft` + file d'approbation dans le CRM.** Aucun envoi. Acceptation : 20 brouillons relus par Mathys, tous passent les contrôles de code (4.4).

**Phase 4 — `send` + `inbox` + `supervisor`.** Domaine de test d'abord, puis premiers envois à 5/jour après accord explicite de Mathys. Acceptation : un cycle complet envoi → réponse → classification → désinscription testé sur des adresses de test de Mathys.

**Phase 5 — Mesure et recalibrage** selon la section 7.
