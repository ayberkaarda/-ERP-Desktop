<?php

declare(strict_types=1);

namespace Tests\Fixtures\Svc;

use App\Modules\Files\Concerns\HasAttachments;
use App\Modules\Files\Contracts\Attachable;
use Illuminate\Database\Eloquent\Model;

final class AttachableDoc extends Model implements Attachable
{
    use HasAttachments;

    public $timestamps = false;

    public $incrementing = false;

    protected $table = 'svc_docs';

    protected $keyType = 'string';

    protected $guarded = [];
}
