<?php

declare(strict_types=1);

return [
    'invalid_date' => 'Geben Sie ein g?ltiges Belegdatum ein.',
    'invalid_content' => 'Der Kontoauszug ist leer, zu gro?, fehlerhaft oder ?berschreitet das Zeilenlimit.',
    'invalid_format' => 'Das Format oder die Importoption wird nicht unterst?tzt.',
    'invalid_amount' => 'Verwenden Sie einen exakten Dezimalbetrag ohne Tausendertrennzeichen oder Exponentialschreibweise.',
    'invalid_currency' => 'Die W?hrung stimmt nicht mit dem gew?hlten Konto ?berein.',
    'balance_mismatch' => 'Anfangssaldo plus Transaktionen muss dem Endsaldo entsprechen.',
    'invalid_mt940' => 'Verwenden Sie einen vollst?ndigen endg?ltigen MT940-Auszug mit unterst?tzten Feldern.',
    'invalid_account' => 'W?hlen Sie ein aktives Konto mit passendem Typ und passender W?hrung.',
    'account_reference_mismatch' => 'Die Kontoreferenz stimmt nicht mit der IBAN ?berein.',
    'duplicate_statement' => 'Dieser Kontoauszug wurde bereits importiert.',
    'payment_matched' => 'Heben Sie die Zuordnung vor Wiederverwendung oder Stornierung auf.',
    'payment_mismatch' => 'W?hlen Sie eine nicht stornierte Buchung mit gleichem Konto, W?hrung, Vorzeichen und Betrag.',
    'unmatched_lines' => 'Ordnen Sie zuerst alle Auszugszeilen nicht stornierten Buchungen zu.',
    'invalid_transition' => 'Diese Aktion ist im aktuellen Belegstatus nicht m?glich.',
    'invalid_party' => 'W?hlen Sie einen aktiven Kunden oder Lieferanten mit der erforderlichen Rolle.',
    'invalid_invoice' => 'Rechnung, Partner, W?hrung, Saldo oder Richtung der Zuordnung ist ung?ltig.',
    'duplicate_allocation' => 'Eine Rechnung darf je Zuordnungsgruppe nur einmal vorkommen.',
    'historical_not_supported' => 'Dieser Bericht zeigt den aktuellen Stand; historische Daten werden nicht unterst?tzt.',
    'export_too_large' => 'Der Bericht ?berschreitet die Grenze von 50000 Zeilen. Grenzen Sie die Filter ein.',
    'duplicate_instrument' => 'Ein Instrument mit dieser Nummer, Art und Richtung ist bereits vorhanden.',
    'scan_too_large' => 'Die Quelle ?berschreitet die unterst?tzte Grenze von 50000 offenen Rechnungen.',
];
