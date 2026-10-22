<?php

declare(strict_types=1);

// Bezeichnungen der Einkaufseinstellungen (angezeigt als settings::registry.<key>).
return [
    'purchasing.allow_direct_receipt' => 'Wareneingänge ohne Bestellung erlauben',
    'purchasing.match_mode' => 'Dreifacher Abgleich',
    'purchasing.match_qty_tolerance_percent' => 'Mengentoleranz beim Abgleich (%)',
    'purchasing.match_price_tolerance_percent' => 'Preistoleranz beim Abgleich (%)',
    'purchasing.allow_over_receipt_percent' => 'Erlaubte Überlieferung in Prozent',
    'purchasing.require_approval_over' => 'Bestellungen über diesem Betrag brauchen eine Genehmigung',
    'purchasing.request_approval_over' => 'Bedarfsanforderungen über diesem Betrag brauchen eine Genehmigung',
    'purchasing.invoice_approval_over' => 'Eingangsrechnungen über diesem Betrag brauchen eine Genehmigung',
    'purchasing.default_warehouse_id' => 'Standardlager für den Einkauf',
    'purchasing.rounding' => 'Rundung der Einkaufsbelege',
];
