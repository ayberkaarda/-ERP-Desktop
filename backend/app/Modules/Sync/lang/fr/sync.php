<?php

declare(strict_types=1);

return [
    'duplicate_resource' => 'Une ressource ne peut apparaître qu’une fois par requête.',
    'resource_unsupported' => 'Cette ressource n’est pas disponible pour la synchronisation.',
    'cursor_invalid' => 'Le curseur est invalide ou n’a pas été émis par ce serveur.',
    'depends_on_forward' => 'depends_on ne peut désigner que des mutations envoyées auparavant.',
    'depends_on_unknown' => 'depends_on désigne une mutation inconnue du serveur.',
    'base_version_create' => 'base_version doit être null pour create.',
    'base_version_required' => 'base_version est requis pour cette opération.',
    'changed_fields_empty' => 'changed_fields doit être vide pour create et delete.',
    'payload_empty' => 'Le payload d’un delete doit être vide.',
    'changed_fields_required' => 'changed_fields et payload sont requis pour update et action.',
    'action_mismatch' => 'action n’est autorisé et requis que pour op action.',
    'payload_version' => 'Le payload ne doit pas contenir version.',
];
