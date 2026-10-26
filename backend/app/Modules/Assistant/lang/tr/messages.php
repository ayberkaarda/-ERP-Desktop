<?php

declare(strict_types=1);

return [
    'new_conversation' => 'Yeni konuşma',
    'approval_reason' => 'Önerilen alanları inceleyin. Onay yalnızca taslak oluşturur.',
    'failed' => 'Asistan bu mesajı tamamlayamadı. Daha sonra yeniden deneyin.',
    'interrupted' => 'Bu mesajın işlenmesi kesintiye uğradı.',
    'rejected' => 'Bu taslağı reddettiniz.',
    'errors' => [
        'ASSISTANT_DISABLED' => 'Asistan devre dışı.',
        'ASSISTANT_NOT_CONFIGURED' => 'Asistan sağlayıcısını ve modelini yapılandırın.',
        'FORBIDDEN' => 'Bu asistan işlemi için yetkiniz yok.',
        'ASSISTANT_BUSY' => 'Başka bir mesaj işleniyor.',
        'ASSISTANT_APPROVAL_PENDING' => 'Önce bekleyen taslak onaylarını sonuçlandırın.',
        'ASSISTANT_BUDGET_EXCEEDED' => 'Günlük asistan token bütçeniz tükendi.',
        'ASSISTANT_TURN_LIMIT' => 'Bu işlem token veya adım sınırına ulaştı.',
        'ASSISTANT_REQUEST_CONFLICT' => 'Bu istek kimliği başka bir mesaj için kullanıldı.',
        'ASSISTANT_TOOL_UNAVAILABLE' => 'Bu taslak aracına artık erişemiyorsunuz.',
        'ASSISTANT_TOOL_LIMIT' => 'İstenen araç verisi izin verilen sınırı aşıyor.',
        'ASSISTANT_APPROVAL_RESOLVED' => 'Bu onay daha önce sonuçlandırıldı.',
    ],
];
