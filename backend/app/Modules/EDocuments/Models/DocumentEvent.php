<?php

declare(strict_types=1);

namespace App\Modules\EDocuments\Models;

use App\Core\Company\BelongsToCompany;
use App\Core\Support\HasUuid7;
use Illuminate\Database\Eloquent\Model;

final class DocumentEvent extends Model
{
    use BelongsToCompany, HasUuid7;

    protected $table = 'edocument_events';

    protected $guarded = [];
}
