<?php

declare(strict_types=1);

return [
    'duplicate_resource' => 'Bir kaynak istekte yalnızca bir kez geçebilir.',
    'resource_unsupported' => 'Bu kaynak senkron için kullanılamaz.',
    'cursor_invalid' => 'Cursor biçimsiz ya da bu sunucu tarafından verilmemiş.',
    'depends_on_forward' => 'depends_on yalnızca daha önce gönderilmiş mutasyonları gösterebilir.',
    'depends_on_unknown' => 'depends_on sunucunun bilmediği bir mutasyonu gösteriyor.',
    'base_version_create' => 'create için base_version null olmalıdır.',
    'base_version_required' => 'Bu işlem için base_version zorunludur.',
    'changed_fields_empty' => 'create ve delete için changed_fields boş olmalıdır.',
    'payload_empty' => 'delete payload alanı boş olmalıdır.',
    'changed_fields_required' => 'update ve action için changed_fields ve payload zorunludur.',
    'action_mismatch' => 'action yalnızca op action iken verilir ve o zaman zorunludur.',
    'payload_version' => 'payload version içeremez.',
    'id_taken' => 'Bu id zaten kullanılıyor.',
];
