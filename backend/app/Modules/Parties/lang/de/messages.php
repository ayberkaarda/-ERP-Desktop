<?php

declare(strict_types=1);

return [
    'invalid_vkn' => 'Die Steuernummer muss eine gültige 10-stellige VKN sein.',
    'invalid_tckn' => 'Die Identitätsnummer muss eine gültige 11-stellige türkische Identitätsnummer sein.',
    'invalid_foreign_tax_number' => 'Die Steuernummer darf bis zu 32 Buchstaben, Ziffern, Leerzeichen und die Zeichen . - / enthalten.',
    'tax_number_taken' => 'Es gibt bereits einen aktiven Geschäftspartner mit dieser Steuernummer.',
    'invalid_iban' => 'Die IBAN ist ungültig.',
    'iban_taken' => 'Diese IBAN ist für den Geschäftspartner bereits erfasst.',
    'reference_not_found' => 'Der ausgewählte Wert existiert nicht.',
    'risk_currency_required' => 'Bei einem Risikolimit ist eine Währung erforderlich.',
    'duplicate_criteria' => 'Geben Sie für die Dublettensuche eine Steuernummer oder einen Namen an.',
    'deactivated_in_use' => 'Der Geschäftspartner wird verwendet und wurde deaktiviert statt gelöscht.',
    'export_too_large' => 'Der Export ist auf :max Zeilen begrenzt; bitte die Filter eingrenzen.',
];
