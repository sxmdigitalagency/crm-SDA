-- Identité du modèle de devis SXM Digital : responsable, statut juridique, conditions structurées.
ALTER TABLE settings ADD COLUMN owner_name TEXT NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN legal_form TEXT NOT NULL DEFAULT '';

-- Conditions au format « Libellé : texte » (une par ligne), reprises du modèle de l'agence.
-- Appliquées seulement si le champ est encore vide ou au texte d'origine.
UPDATE settings SET quote_terms =
'Validité : 30 jours à compter de la date d''émission.
Acompte : 40 % à la signature, solde à la livraison.
Paiement : virement bancaire, à 15 jours date de facture.
Retard de paiement : pénalités au taux de 3 fois le taux d''intérêt légal + indemnité forfaitaire de 40 € pour frais de recouvrement.
Propriété : le site et ses contenus sont cédés au client après paiement intégral.
Hors périmètre : toute demande non listée ci-dessus fera l''objet d''un devis complémentaire.'
WHERE id = 1 AND quote_terms = '';

UPDATE settings SET invoice_terms =
'Paiement : virement bancaire, à 15 jours date de facture.
Retard de paiement : pénalités au taux de 3 fois le taux d''intérêt légal + indemnité forfaitaire de 40 € pour frais de recouvrement.
Escompte : aucun escompte pour paiement anticipé.'
WHERE id = 1 AND (invoice_terms = '' OR substr(invoice_terms, 1, 29) = 'En cas de retard de paiement,');

-- Le modèle annonce un paiement à 15 jours : aligner l'échéance si elle est restée à la valeur d'origine.
UPDATE settings SET payment_terms_days = 15 WHERE id = 1 AND payment_terms_days = 30;
