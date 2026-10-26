<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Models;

use App\Core\Company\BelongsToCompany;
use App\Core\Support\HasUuid7;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * A supplier invited to an RFQ: invited, responded (has quotes) or declined.
 *
 * @property string $id
 * @property string $company_id
 * @property string $rfq_id
 * @property string $party_id
 * @property string $party_name
 * @property string $status
 * @property Carbon|null $responded_at
 */
class RfqSupplier extends Model
{
    use BelongsToCompany;
    use HasUuid7;

    protected $table = 'purchase_rfq_suppliers';

    /** @var list<string> */
    protected $guarded = ['id', 'company_id'];

    /** @var array<string, mixed> */
    protected $attributes = ['status' => 'invited'];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['responded_at' => 'datetime'];
    }
}
