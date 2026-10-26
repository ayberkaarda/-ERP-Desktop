<?php

declare(strict_types=1);

return [
    'invalid_date' => 'Ge?erli bir belge tarihi girin.',
    'invalid_content' => 'Ekstre bo?, ?ok b?y?k, hatal? veya desteklenen sat?r s?n?r?n? a??yor.',
    'invalid_format' => 'Ekstre bi?imi veya ayr??t?rma se?ene?i desteklenmiyor.',
    'invalid_amount' => 'Binlik ay?r?c? veya ?stel g?sterim i?ermeyen tam bir ondal?k tutar kullan?n.',
    'invalid_currency' => 'Para birimi se?ili hesapla e?le?miyor.',
    'balance_mismatch' => 'A??l?? bakiyesi ile i?lemlerin toplam? kapan?? bakiyesine e?it olmal?d?r.',
    'invalid_mt940' => 'Desteklenen etiketleri i?eren tek ve tam bir nihai MT940 ekstresi kullan?n.',
    'invalid_account' => 'Uyumlu t?r ve para birimine sahip etkin bir hesap se?in.',
    'account_reference_mismatch' => 'Ekstre hesap bilgisi banka hesab?n?n IBAN bilgisiyle e?le?miyor.',
    'duplicate_statement' => 'Bu ekstre daha ?nce i?e aktar?lm??.',
    'payment_matched' => 'Bu hareketi yeniden kullanmadan veya ters kaydetmeden ?nce ekstre e?le?tirmesini kald?r?n.',
    'payment_mismatch' => 'Hesab?, para birimi, y?n? ve tutar? ayn? olan, ters kaydedilmemi? bir hareket se?in.',
    'unmatched_lines' => '?nce t?m ekstre sat?rlar?n? ters kaydedilmemi? hareketlerle e?le?tirin.',
    'invalid_transition' => 'Bu i?lem belgenin mevcut durumunda yap?lamaz.',
    'invalid_party' => 'Gerekli m??teri veya tedarik?i rol?ne sahip etkin bir cari se?in.',
    'invalid_invoice' => 'Da??t?mdaki fatura, cari, para birimi, bakiye veya i?lem y?n? ge?ersiz.',
    'duplicate_allocation' => 'Bir fatura ayn? da??t?m grubunda yaln?zca bir kez yer alabilir.',
    'historical_not_supported' => 'Bu rapor g?ncel durumu g?sterir; ge?mi? tarih desteklenmiyor.',
    'export_too_large' => 'Rapor 50000 sat?rl?k g?venlik s?n?r?n? a??yor. Filtreleri daralt?n.',
    'duplicate_instrument' => 'Bu numara, t?r ve y?nde bir k?ymetli evrak zaten var.',
    'scan_too_large' => 'Kaynak, desteklenen 50000 a??k fatura tarama s?n?r?n? a??yor.',
];
