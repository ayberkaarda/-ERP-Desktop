<?php

declare(strict_types=1);

/**
 * Permission declaration of this module, aggregated by Identity's PermissionCatalog and DefaultRoles.
 *
 * Format:
 *   'group'       => module key stored with each permission (Permission.module) and shown by GET /permissions
 *   'permissions' => ['<resource>.<action>' => options]; options (all optional):
 *       'roles'            => default roles granted this permission in every new company. Allowed names:
 *                             Admin, Accountant, Sales, Purchasing, Warehouse, HR, Viewer; '*' = every default role.
 *                             Admin always receives the whole catalog, so listing it is optional.
 *       'super_admin_only' => true: never granted to Admin by default and not delegable by non-super-admins.
 * A permission name may be declared by one module only.
 */

return [
    'group' => 'files',
    'permissions' => [
        'files.view' => ['roles' => ['*']],
        'files.create' => ['roles' => ['*']],
        'files.delete' => [],
    ],
];
