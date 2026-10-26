<?php

declare(strict_types=1);

namespace App\Modules\EDocuments\Contracts;

use App\Modules\EDocuments\Data\XmlDocumentSnapshot;
use App\Modules\EDocuments\Data\XmlValidationResult;

interface DocumentXml
{
    public function available(): bool;

    public function generate(XmlDocumentSnapshot $snapshot): string;

    public function validate(string $xml, string $kind): XmlValidationResult;

    public function parse(string $xml): XmlDocumentSnapshot;
}
