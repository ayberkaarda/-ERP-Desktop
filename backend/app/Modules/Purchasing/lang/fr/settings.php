<?php

declare(strict_types=1);

// Libellés des paramètres d'achat (affichés comme settings::registry.<clé>).
return [
    'purchasing.allow_direct_receipt' => 'Autoriser les réceptions sans commande',
    'purchasing.match_mode' => 'Rapprochement à trois voies',
    'purchasing.match_qty_tolerance_percent' => 'Tolérance de quantité du rapprochement (%)',
    'purchasing.match_price_tolerance_percent' => 'Tolérance de prix du rapprochement (%)',
    'purchasing.allow_over_receipt_percent' => 'Pourcentage de surlivraison autorisé',
    'purchasing.require_approval_over' => 'Les commandes d’achat au-dessus de ce montant nécessitent une approbation',
    'purchasing.request_approval_over' => 'Les demandes d’achat au-dessus de ce montant nécessitent une approbation',
    'purchasing.invoice_approval_over' => 'Les factures fournisseurs au-dessus de ce montant nécessitent une approbation',
    'purchasing.default_warehouse_id' => 'Entrepôt d’achat par défaut',
    'purchasing.rounding' => 'Arrondi des documents d’achat',
];
