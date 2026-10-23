<?php

declare(strict_types=1);

namespace App\Modules\EDocuments\Models;

use App\Core\Company\BelongsToCompany;
use App\Core\Support\HasUuid7;
use App\Modules\EDocuments\Enums\DocumentKind;
use App\Modules\EDocuments\Enums\DocumentStatus;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/** @property string $id
 * @property string $company_id
 * @property string $created_by
 * @property string $direction
 * @property DocumentKind $kind
 * @property DocumentStatus $status
 * @property string $profile
 * @property string $uuid
 * @property string|null $number
 * @property string $series
 * @property Carbon $document_date
 * @property string $currency_code
 * @property string $total
 * @property string $party_name
 * @property string|null $source_id
 * @property string|null $source_type
 * @property string|null $source_number
 * @property int|null $source_version
 * @property string|null $source_hash
 * @property string|null $purchase_invoice_id
 * @property array<string,mixed> $snapshot
 * @property array<string,mixed> $metadata
 * @property array<string,mixed> $validation
 * @property string|null $xml
 * @property string|null $xml_hash
 * @property string|null $provider_key
 * @property string|null $provider_id
 * @property int $version
 * @property Carbon $created_at
 * @property Carbon $updated_at
 */
final class Document extends Model
{
    use BelongsToCompany, HasUuid7;

    protected $table = 'edocuments';

    protected $guarded = [];

    protected function casts(): array
    {
        return ['kind' => DocumentKind::class, 'status' => DocumentStatus::class, 'document_date' => 'date', 'total' => 'decimal:4', 'version' => 'integer', 'source_version' => 'integer', 'snapshot' => 'array', 'metadata' => 'array', 'validation' => 'array'];
    }
}
