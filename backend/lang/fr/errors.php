<?php

declare(strict_types=1);

return [
    'validation_error' => 'Les données fournies sont invalides.',
    'unauthenticated' => 'Une authentification est requise.',
    'forbidden' => 'Vous n\'êtes pas autorisé à effectuer cette action.',
    'not_found' => 'La ressource demandée est introuvable.',
    'method_not_allowed' => 'Cette méthode n\'est pas autorisée pour la ressource demandée.',
    'too_many_attempts' => 'Trop de tentatives. Veuillez réessayer plus tard.',
    'http_error' => 'La requête n\'a pas pu être traitée.',
    'server_error' => 'Une erreur inattendue est survenue.',
    'version_conflict' => 'L\'enregistrement a été modifié par quelqu\'un d\'autre. Rechargez-le et réessayez.',
    'idempotency_key_required' => 'Un en-tête Idempotency-Key est requis pour cette requête.',
    'idempotency_key_reused' => 'Cette clé d\'idempotence a déjà été utilisée avec une autre requête.',
    'idempotency_in_progress' => 'Une requête avec cette clé d\'idempotence est toujours en cours de traitement.',
    'company_required' => 'Une société active doit être sélectionnée.',
    'company_forbidden' => 'Vous n\'avez pas accès à cette société.',
    'two_factor_required' => 'Une authentification à deux facteurs est requise.',
    'invalid_two_factor_code' => 'Le code à deux facteurs est invalide.',
    'password_change_required' => 'Vous devez changer votre mot de passe avant de continuer.',
    'user_deactivated' => 'Ce compte utilisateur est désactivé.',
    'invalid_state_transition' => 'Ce changement de statut n\'est pas autorisé.',
    'approval_required' => 'Ce document doit d\'abord être approuvé.',
    'file_too_large' => 'Le fichier est trop volumineux.',
    'unsupported_file_type' => 'Ce type de fichier n\'est pas pris en charge.',
];
