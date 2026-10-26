# ADR 0004: xid watermark ile artımlı senkron okuması

- Durum: Kabul edildi
- Tarih: 2026-10-26

## Bağlam

Masaüstü istemci ana verileri ve son belgeleri yerelde tutar ve yalnızca değişenleri indirmelidir. Tek bir global sayaç satırı her yazmayı sıraya sokar ve web yazmalarını yavaşlatır. Zaman damgasına dayalı cursor ise eşzamanlı transaction'larda satır atlar: geç commit edilen bir transaction, cursor'ın gerisinde kalan bir değerle görünür.

## Karar

Senkronlanan tablolara `syncable()` migration makrosuyla `sync_txid xid8` kolonu, index ve `BEFORE INSERT OR UPDATE` trigger'ı eklenir; trigger `pg_current_xact_id()` yazar. Silme ve soft delete, aynı değerle `sync_tombstones` tablosuna satır ekler.

Pull her istekte `horizon = pg_snapshot_xmin(pg_current_snapshot())` alır ve kaynak başına `sync_txid < horizon` olan satırları ve tombstone'ları `(sync_txid, id)` keyset sayfalamasıyla döner. Cursor `{txid, after_id}` nesnesidir; `xid8` değerleri ondalık string olarak taşınır.

Satırlar REST API Resource JSON'u olarak döner; ayrı senkron DTO'su yoktur. Tombstone'lar 90 gün saklanır. Daha eski cursor, görünürlük değişimi veya uyumsuz şema değişimi kaynak için `reset` üretir.

Hesaplanmış bakiyeler (stok bakiyesi, cari yaşlandırma) syncable değildir; REST ucundan anlık görüntü olarak alınır.

## Sonuçlar

Web yazmaları kilit veya sayaç beklemez. Horizon'un altındaki tüm transaction'lar tamamlandığından satır atlanmaz. Uzun süren transaction'lar yalnızca senkronu geciktirir ve izlenmelidir. Her syncable tabloya trigger ve kolon eklenir; alt tablo yazmaları gömülü oldukları üst satırın `sync_txid`'ini de güncellemelidir. Ayrıntılar `docs/SYNC-PROTOCOL.md` ve `contracts/sync/` altındadır.
