<?php

declare(strict_types=1);

return [
    'validation_error' => 'Gönderilen veriler geçersiz.',
    'unauthenticated' => 'Oturum açmanız gerekiyor.',
    'forbidden' => 'Bu işlemi yapma yetkiniz yok.',
    'not_found' => 'İstenen kayıt bulunamadı.',
    'method_not_allowed' => 'Bu kaynak için istek yöntemi desteklenmiyor.',
    'too_many_attempts' => 'Çok fazla deneme yapıldı. Lütfen daha sonra tekrar deneyin.',
    'http_error' => 'İstek işlenemedi.',
    'server_error' => 'Beklenmeyen bir hata oluştu.',
    'version_conflict' => 'Kayıt başka biri tarafından değiştirildi. Yenileyip tekrar deneyin.',
    'idempotency_key_required' => 'Bu istek için Idempotency-Key başlığı gerekli.',
    'idempotency_key_reused' => 'Bu idempotency anahtarı farklı bir istekle zaten kullanıldı.',
    'idempotency_in_progress' => 'Bu idempotency anahtarıyla gönderilen istek hâlâ işleniyor.',
    'company_required' => 'Aktif bir şirket seçilmelidir.',
    'company_forbidden' => 'Bu şirkete erişim yetkiniz yok.',
    'two_factor_required' => 'İki adımlı doğrulama gerekli.',
    'invalid_two_factor_code' => 'İki adımlı doğrulama kodu geçersiz.',
    'password_change_required' => 'Devam etmeden önce şifrenizi değiştirmelisiniz.',
    'user_deactivated' => 'Bu kullanıcı hesabı devre dışı.',
    'invalid_state_transition' => 'Bu durum değişikliğine izin verilmiyor.',
    'approval_required' => 'Bu belge önce onaylanmalıdır.',
    'file_too_large' => 'Dosya çok büyük.',
    'unsupported_file_type' => 'Bu dosya türü desteklenmiyor.',
];
