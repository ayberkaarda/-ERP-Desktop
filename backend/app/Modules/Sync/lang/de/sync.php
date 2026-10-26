<?php

declare(strict_types=1);

return [
    'duplicate_resource' => 'Eine Ressource darf pro Anfrage nur einmal vorkommen.',
    'resource_unsupported' => 'Diese Ressource ist für die Synchronisierung nicht verfügbar.',
    'cursor_invalid' => 'Der Cursor ist ungültig oder stammt nicht von diesem Server.',
    'depends_on_forward' => 'depends_on darf nur früher gesendete Mutationen nennen.',
    'depends_on_unknown' => 'depends_on nennt eine dem Server unbekannte Mutation.',
    'base_version_create' => 'base_version muss bei create null sein.',
    'base_version_required' => 'base_version ist für diese Operation erforderlich.',
    'changed_fields_empty' => 'changed_fields muss bei create und delete leer sein.',
    'payload_empty' => 'Die Nutzlast eines delete muss leer sein.',
    'changed_fields_required' => 'changed_fields und payload sind bei update und action erforderlich.',
    'action_mismatch' => 'action ist nur bei op action erlaubt und dort erforderlich.',
    'payload_version' => 'Die Nutzlast darf version nicht enthalten.',
    'id_taken' => 'Diese id ist bereits vergeben.',
];
