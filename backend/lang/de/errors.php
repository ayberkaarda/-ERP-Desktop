<?php

declare(strict_types=1);

return [
    'validation_error' => 'Die übermittelten Daten sind ungültig.',
    'unauthenticated' => 'Eine Anmeldung ist erforderlich.',
    'forbidden' => 'Sie dürfen diese Aktion nicht ausführen.',
    'not_found' => 'Die angeforderte Ressource wurde nicht gefunden.',
    'method_not_allowed' => 'Diese Methode ist für die angeforderte Ressource nicht erlaubt.',
    'too_many_attempts' => 'Zu viele Versuche. Bitte versuchen Sie es später erneut.',
    'http_error' => 'Die Anfrage konnte nicht verarbeitet werden.',
    'server_error' => 'Ein unerwarteter Fehler ist aufgetreten.',
    'version_conflict' => 'Der Datensatz wurde von jemand anderem geändert. Laden Sie ihn neu und versuchen Sie es erneut.',
    'idempotency_key_required' => 'Für diese Anfrage ist ein Idempotency-Key-Header erforderlich.',
    'idempotency_key_reused' => 'Dieser Idempotenzschlüssel wurde bereits mit einer anderen Anfrage verwendet.',
    'idempotency_in_progress' => 'Eine Anfrage mit diesem Idempotenzschlüssel wird noch verarbeitet.',
    'company_required' => 'Es muss ein aktives Unternehmen ausgewählt werden.',
    'company_forbidden' => 'Sie haben keinen Zugriff auf dieses Unternehmen.',
    'two_factor_required' => 'Eine Zwei-Faktor-Authentifizierung ist erforderlich.',
    'invalid_two_factor_code' => 'Der Zwei-Faktor-Code ist ungültig.',
    'password_change_required' => 'Sie müssen Ihr Passwort ändern, bevor Sie fortfahren.',
    'user_deactivated' => 'Dieses Benutzerkonto ist deaktiviert.',
    'invalid_state_transition' => 'Dieser Statuswechsel ist nicht erlaubt.',
    'approval_required' => 'Dieses Dokument muss zuerst genehmigt werden.',
    'file_too_large' => 'Die Datei ist zu groß.',
    'unsupported_file_type' => 'Dieser Dateityp wird nicht unterstützt.',
];
