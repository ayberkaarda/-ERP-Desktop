<?php

declare(strict_types=1);

namespace App\Modules\Reference\Database\seeders;

use App\Modules\Reference\Models\TaxCode;
use App\Modules\Reference\Services\CurrencyCatalog;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

final class ReferenceSeeder extends Seeder
{
    public function run(): void
    {
        DB::transaction(function (): void {
            // Idempotent: missing currencies are added, existing (also soft deleted) rows are kept.
            CurrencyCatalog::ensure();
            // Sources retrieved 2026-10-21; see docs/TAX-ENGINE.md (SOURCES).
            // GİB consolidated Karar 2007/13033 art. 1: %20 and %10 changed by Karar 7346 (in force 10/07/2023); %1 unchanged since the Karar took effect (31/12/2007).
            foreach ([['1', '2007-12-31'], ['10', '2023-07-10'], ['20', '2023-07-10']] as [$rate, $from]) {
                $this->tax('VAT'.$rate, [
                    'name' => 'KDV %'.$rate, 'type' => 'vat', 'rate' => $rate, 'effective_from' => $from,
                ], self::RATES, 'verified', true, 'Karar 2007/13033 art. 1(1)');
            }
            // Zero is not a rate in Karar 2007/13033; zero KDV only arises together with an exemption code.
            $this->tax('VAT0', [
                'name' => 'KDV %0', 'type' => 'vat', 'rate' => '0', 'effective_from' => '2023-07-10',
            ], self::RATES, 'needs_review', false, 'Technical zero rate; use only with an exemption code such as 301.');
            // UBL-TR Kod Listeleri V1.43, TAM İSTİSNA KODLARI LİSTESİ: 301 = 11/1-a Mal İhracatı.
            $this->tax('301', [
                'name' => '11/1-a Mal ihracatı', 'type' => 'exemption', 'rate' => null, 'effective_from' => '2023-07-10',
            ], self::CODE_LIST, 'verified', false, 'Code and meaning verified; effective_from is a placeholder start, not a legal date.');
            // UBL-TR Kod Listeleri V1.43 TEVKİFAT KODLARI LİSTESİ 601 = 4/10; KDVGUT I/C-2.1.3.2.1.1 (35 Seri No.lu Tebliğ, in force 1/3/2021).
            $this->tax('601', [
                'name' => 'Yapım işleri ile bu işlerle birlikte ifa edilen mühendislik-mimarlık ve etüt-proje hizmetleri',
                'type' => 'withholding', 'rate' => null, 'numerator' => 4, 'denominator' => 10, 'effective_from' => '2021-03-01',
            ], self::KDVGUT, 'verified', true, 'Applies to buyers in KDVGUT I/C-2.1.3.1/b, and to I/C-2.1.3.1/a buyers when the KDV-inclusive contract value is 5 million TL or more.');
        });
    }

    private const string RATES = 'https://cdn.gib.gov.tr/api/gibportal-file/file/getFileResources?objectKey=arsiv%2Fyardim-kaynaklar%2Fyararli-bilgiler%2Fkdv-oranlari.pdf';

    private const string CODE_LIST = 'https://ebelge.gib.gov.tr/dosyalar/kilavuzlar/UBLTR_1.2.1_Kilavuzlar.zip';

    private const string KDVGUT = 'https://cdn.gib.gov.tr/api/gibportal-file/file/getFile?objectKey=MEVZUAT_TEBLIGLER%2FUNIVERSAL%2F2026%2Fkdv_genteb.pdf';

    /** @param array<string, mixed> $attributes */
    private function tax(string $code, array $attributes, string $source, string $status, bool $periodVerified, string $note): void
    {
        // Existing reference rows are preserved until a reviewed migration replaces them.
        $record = TaxCode::query()->withoutGlobalScope('visible')->whereNull('company_id')->where('code', $code)->first();
        if ($record === null) {
            $record = new TaxCode($attributes + [
                'code' => $code, 'is_active' => true,
                'meta' => [
                    'status' => $status, 'source_url' => $source,
                    'retrieved_at' => '2026-10-21', 'effective_period_verified' => $periodVerified,
                    'note' => $note,
                ],
            ]);
            $record->save();
        }
    }
}
