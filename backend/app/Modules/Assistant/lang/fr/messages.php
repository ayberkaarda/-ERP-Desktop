<?php

declare(strict_types=1);

return [
    'new_conversation' => 'Nouvelle conversation',
    'approval_reason' => 'Vérifiez les champs proposés. La validation crée uniquement un brouillon.',
    'failed' => 'L’assistant n’a pas pu terminer ce message. Réessayez plus tard.',
    'interrupted' => 'Ce message a été interrompu.',
    'rejected' => 'Vous avez refusé ce brouillon.',
    'errors' => [
        'ASSISTANT_DISABLED' => 'L’assistant est désactivé.',
        'ASSISTANT_NOT_CONFIGURED' => 'Configurez le fournisseur et le modèle de l’assistant.',
        'FORBIDDEN' => 'Vous n’avez pas les droits pour cette opération.',
        'ASSISTANT_BUSY' => 'Un autre message est en cours de traitement.',
        'ASSISTANT_APPROVAL_PENDING' => 'Traitez d’abord les validations de brouillons en attente.',
        'ASSISTANT_BUDGET_EXCEEDED' => 'Votre budget quotidien de jetons est épuisé.',
        'ASSISTANT_TURN_LIMIT' => 'La limite de jetons ou d’étapes est atteinte.',
        'ASSISTANT_REQUEST_CONFLICT' => 'Cet identifiant de requête a déjà été utilisé pour un autre message.',
        'ASSISTANT_TOOL_UNAVAILABLE' => 'Cet outil de brouillon n’est plus disponible.',
        'ASSISTANT_TOOL_LIMIT' => 'Les données demandées dépassent la limite autorisée.',
        'ASSISTANT_APPROVAL_RESOLVED' => 'Cette validation a déjà été traitée.',
    ],
];
