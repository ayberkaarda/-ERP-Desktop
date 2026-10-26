<?php

declare(strict_types=1);

namespace App\Modules\EDocuments\Contracts;

use App\Modules\EDocuments\Data\ProviderReceipt;

interface EDocumentProvider
{
    public function send(string $key, string $uuid, string $xml): ProviderReceipt;

    public function status(string $id): ProviderReceipt;

    public function respond(string $uuid, string $xml, string $decision): ProviderReceipt;

    /** @return array{tax_number:string,registered:bool,aliases:list<array{alias:string,kind:string}>,sandbox:bool} */
    public function taxpayer(string $taxNumber): array;
}
