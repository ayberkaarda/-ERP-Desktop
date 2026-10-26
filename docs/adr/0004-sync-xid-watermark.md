# ADR 0004: xid watermark ile artımlı senkron okuması

- Durum: Kabul edildi
- Tarih: 2026-10-26

## Bağlam

Masaüstü istemci ana verileri ve son belgeleri yerelde tutar ve yalnızca değişenleri indirmelidir. Tek bir global sayaç satırı her yazmayı sıraya sokar ve web yazmalarını yavaşlatır. Zaman damgasına dayalı cursor ise eşzamanlı transaction'larda satır atlar: geç commit edilen bir transaction, cursor'ın gerisinde kalan bir değerle görünür.

## Karar

Senkronlanan tablolara `syncable()` migration makrosuyla `sync_txid xid8` kolonu, index ve `BEFORE INSERT OR UPDATE` trigger'ı eklenir; trigger `pg_current_xact_id()` yazar. Silme ve soft delete, aynı değerle `sync_tombstones` tablosuna `(resource, id)` başına tek satır olarak upsert edilir; restore tombstone'u siler.

Pull her istekte `horizon = pg_snapshot_xmin(pg_current_snapshot())` alır ve kaynak başına `sync_txid < horizon` olan olayları `(sync_txid, id)` keyset sayfalamasıyla döner. Olay akışı sayfalamadan önce tekilleştirilir: canlı satır, aynı `id`'nin tombstone'una her zaman üstündür. Cursor `{txid, after_id, gen}` nesnesidir; `xid8` değerleri ondalık string olarak taşınır.

Kaynaklar şirket kapsamını açıkça bildirir: `company`, `company_or_global` (sistem satırları `company_id IS NULL`) ve `global_with_company_activation` (`currencies` + `company_currencies`; konum iki tablonun `sync_txid`'lerinin büyüğüdür).

Satırlar REST API Resource JSON'u olarak döner; ayrı senkron DTO'su yoktur. Tombstone'lar 90 gün saklanır; temizlik `(company, resource)` başına yalnızca büyüyen, dışlayıcı üst sınır olan bir `tombstone_floor_txid` (temizlenen en büyük `sync_txid` + 1) bırakır ve `cursor.txid` bundan küçükse reset alır. Pencereli kaynaklarda pencere bir dönüşümdür: değişip pencere dışına çıkan satır `out_of_scope` tombstone'u olarak döner. Görünürlük, sunucuda `(user, company, resource)` başına tutulan ve yalnızca artan bir nesille izlenir; cursor'daki nesil güncel değilse kaynak reset alır. Nesil tüketilen bir bayrak olmadığından her cihaz kendi başına doğru sonuca varır. Uyumsuz şema değişimi de reset üretir.

Hesaplanmış bakiyeler (stok bakiyesi, cari yaşlandırma) syncable değildir; REST ucundan anlık görüntü olarak alınır.

## Sonuçlar

Web yazmaları kilit veya sayaç beklemez. Horizon'un altındaki tüm transaction'lar tamamlandığından satır atlanmaz. Uzun süren transaction'lar yalnızca senkronu geciktirir ve izlenmelidir. Her syncable tabloya trigger ve kolon eklenir; alt tablo yazmaları gömülü oldukları üst satırın `sync_txid`'ini de güncellemelidir. Ayrıntılar `docs/SYNC-PROTOCOL.md` ve `contracts/sync/` altındadır.
