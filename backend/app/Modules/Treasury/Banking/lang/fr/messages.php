<?php

declare(strict_types=1);

return [
    'invalid_date' => 'Saisissez une date de pi?ce valide.',
    'invalid_content' => 'Le relev? est vide, trop volumineux, mal form? ou d?passe la limite de lignes.',
    'invalid_format' => 'Le format ou l?option d?importation n?est pas pris en charge.',
    'invalid_amount' => 'Utilisez un montant d?cimal exact sans s?parateur de milliers ni notation exponentielle.',
    'invalid_currency' => 'La devise ne correspond pas au compte s?lectionn?.',
    'balance_mismatch' => 'Le solde initial plus les op?rations doit ?tre ?gal au solde final.',
    'invalid_mt940' => 'Utilisez un relev? MT940 final complet avec les balises prises en charge.',
    'invalid_account' => 'S?lectionnez un compte actif de type et de devise compatibles.',
    'account_reference_mismatch' => 'La r?f?rence du relev? ne correspond pas ? l?IBAN du compte bancaire.',
    'duplicate_statement' => 'Ce relev? a d?j? ?t? import?.',
    'payment_matched' => 'Supprimez le rapprochement avant de r?utiliser ou de contrepasser ce mouvement.',
    'payment_mismatch' => 'S?lectionnez un mouvement non contrepass? de m?mes compte, devise, signe et montant.',
    'unmatched_lines' => 'Rapprochez d?abord toutes les lignes avec des mouvements non contrepass?s.',
    'invalid_transition' => 'Cette action est impossible dans l??tat actuel de la pi?ce.',
    'invalid_party' => 'S?lectionnez un tiers actif disposant du r?le client ou fournisseur requis.',
    'invalid_invoice' => 'La facture, le tiers, la devise, le solde ou le sens de l?affectation est invalide.',
    'duplicate_allocation' => 'Une facture ne peut figurer qu?une fois par groupe d?affectation.',
    'historical_not_supported' => 'Ce rapport montre l??tat actuel ; les dates historiques ne sont pas prises en charge.',
    'export_too_large' => 'Le rapport d?passe la limite de 50000 lignes. Affinez les filtres.',
    'duplicate_instrument' => 'Un instrument de ce num?ro, type et sens existe d?j?.',
    'scan_too_large' => 'La source d?passe la limite de 50000 factures ouvertes prise en charge.',
];
