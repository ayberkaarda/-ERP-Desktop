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
 *
 * Units, unit conversions and categories are readable with items.view; discount rules with pricing.view.
 */

return [
    'group' => 'catalog',
    'permissions' => [
        'items.view' => ['roles' => ['Accountant', 'Purchasing', 'Warehouse']],
        'items.create' => ['roles' => ['Purchasing', 'Warehouse']],
        'items.update' => ['roles' => ['Purchasing', 'Warehouse']],
        'items.delete' => [],
        'units.manage' => ['roles' => ['Purchasing', 'Warehouse']],
        'item_categories.manage' => ['roles' => ['Purchasing', 'Warehouse']],
        'price_lists.view' => ['roles' => ['Accountant', 'Purchasing']],
        'price_lists.create' => [],
        'price_lists.update' => [],
        'price_lists.delete' => [],
        'discount_rules.manage' => [],
        'pricing.view' => ['roles' => ['Accountant', 'Purchasing']],
    ],
];
