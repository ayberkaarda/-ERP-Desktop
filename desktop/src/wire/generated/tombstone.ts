// Do not edit: written by scripts/gen-wire-ts.mjs from contracts/.
// After a contract change run `npm run -w desktop wire:gen` and commit.

/**
 * Tombstone. Senkronlanan bir satırın istemciden kaldırılması gerektiğini bildirir. deleted/soft_deleted: sync_tombstones tablosundaki satırın tel biçimi; 90 gün saklanır. out_of_scope: tabloda saklanmaz; konumu cursor aralığında olan ama artık kaynağın penceresine uymayan canlı satır için pull sırasında üretilir.
 */
export interface Tombstone {
  /**
   * Senkron kaynak adı. /api/v1 sonrasındaki yolun parametresiz bölümlerinin '.' ile birleşimidir: 'parties', 'items.variants', 'treasury-reports.receivables-ageing'.
   */
  resource: string
  /**
   * Küçük harfli kanonik UUID (herhangi bir sürüm). Sunucunun ürettiği satır kimlikleri için.
   */
  id: string
  /**
   * Alt kaynaklarda (ör. items.variants) üst kaydın kimliği.
   */
  parent_id?: string | null
  /**
   * PostgreSQL xid8 değeri (pg_current_xact_id). 64 bit olduğu için ondalık string olarak taşınır; JavaScript sayısına çevrilmez.
   */
  sync_txid: string
  /**
   * Silme zamanı; out_of_scope için satırı kapsamdan çıkaran değişikliğin zamanı (updated_at).
   */
  deleted_at: string
  /**
   * deleted: satır fiziksel olarak silindi. soft_deleted: deleted_at dolduruldu (SoftDeletes). out_of_scope: satır değişti ve window_field değeri artık pencerenin dışında (ör. belge tarihi geriye alındı). Değişmeden yaşlanarak pencereden çıkan belgeler tombstone üretmez; istemci onları kendi bildiği window_field değerine göre budar.
   */
  reason: 'deleted' | 'soft_deleted' | 'out_of_scope'
}
