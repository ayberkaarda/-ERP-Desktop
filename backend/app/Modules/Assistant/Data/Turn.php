<?php

declare(strict_types=1);

namespace App\Modules\Assistant\Data;

use App\Modules\Assistant\Models\Conversation;
use App\Modules\Assistant\Models\Message;

final readonly class Turn
{
    /** @param array{id:string,tokens:int}|null $reservation */
    public function __construct(public Conversation $conversation, public Message $message, public ?string $lease, public ?array $reservation, public string $prompt) {}
}
