# ADR 0002: PostgreSQL ve UUIDv7

- Durum: Kabul edildi
- Tarih: 2026-10-21

## Bağlam

İşlemsel veriler ilişkisel tutarlılık, kesin para aritmetiği ve yatayda kullanılabilir kimlikler gerektirir.

## Karar

Ana ilişkisel veritabanı PostgreSQL'dir. Kayıt kimlikleri UUIDv7 olur. Para değerleri `numeric` türünde saklanır. Eşzamanlı güncellemeler `version` sütunuyla denetlenir ve sürüm çakışması HTTP 409 üretir.

## Sonuçlar

UUIDv7 zaman sıralamasını destekler; `numeric` para hassasiyetini korur. Şirket verileri `company_id` ile kapsamlandırılır. Tekrarlanabilir yazma uçları `Idempotency-Key` kullanır.
