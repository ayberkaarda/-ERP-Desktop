<?php

declare(strict_types=1);

return [
    'invalid_vkn' => 'Le numéro fiscal doit être un VKN valide à 10 chiffres.',
    'invalid_tckn' => "Le numéro d'identité doit être un numéro d'identité turc valide à 11 chiffres.",
    'invalid_foreign_tax_number' => 'Le numéro fiscal peut contenir jusqu’à 32 lettres, chiffres, espaces et caractères . - /.',
    'tax_number_taken' => 'Un tiers actif avec ce numéro fiscal existe déjà.',
    'invalid_iban' => "L'IBAN n'est pas valide.",
    'iban_taken' => 'Cet IBAN est déjà enregistré pour ce tiers.',
    'reference_not_found' => "La valeur sélectionnée n'existe pas.",
    'risk_currency_required' => 'Une devise est requise lorsqu’une limite de risque est définie.',
    'duplicate_criteria' => 'Indiquez un numéro fiscal ou un nom pour rechercher les doublons.',
    'deactivated_in_use' => 'Le tiers est utilisé ; il a été désactivé au lieu d’être supprimé.',
    'export_too_large' => "L'export est limité à :max lignes ; affinez les filtres.",
];
