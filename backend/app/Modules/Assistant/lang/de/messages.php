<?php

declare(strict_types=1);

return [
    'new_conversation' => 'Neues Gespräch',
    'approval_reason' => 'Prüfen Sie die vorgeschlagenen Felder. Die Freigabe erstellt nur einen Entwurf.',
    'failed' => 'Der Assistent konnte diese Nachricht nicht abschließen. Versuchen Sie es später erneut.',
    'interrupted' => 'Diese Nachricht wurde unterbrochen.',
    'rejected' => 'Sie haben diesen Entwurf abgelehnt.',
    'errors' => [
        'ASSISTANT_DISABLED' => 'Der Assistent ist deaktiviert.',
        'ASSISTANT_NOT_CONFIGURED' => 'Konfigurieren Sie Anbieter und Modell des Assistenten.',
        'FORBIDDEN' => 'Sie haben keine Berechtigung für diesen Vorgang.',
        'ASSISTANT_BUSY' => 'Eine andere Nachricht wird verarbeitet.',
        'ASSISTANT_APPROVAL_PENDING' => 'Entscheiden Sie zuerst über die ausstehenden Entwürfe.',
        'ASSISTANT_BUDGET_EXCEEDED' => 'Ihr tägliches Tokenbudget ist aufgebraucht.',
        'ASSISTANT_TURN_LIMIT' => 'Das Token- oder Schrittlimit wurde erreicht.',
        'ASSISTANT_REQUEST_CONFLICT' => 'Diese Anfragekennung wurde bereits für eine andere Nachricht verwendet.',
        'ASSISTANT_TOOL_UNAVAILABLE' => 'Dieses Entwurfswerkzeug ist nicht mehr verfügbar.',
        'ASSISTANT_TOOL_LIMIT' => 'Die angeforderten Daten überschreiten das zulässige Limit.',
        'ASSISTANT_APPROVAL_RESOLVED' => 'Diese Freigabe wurde bereits entschieden.',
    ],
];
