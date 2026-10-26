<?php

declare(strict_types=1);

namespace App\Modules\EDocuments\Validation;

use DOMDocument;
use DOMElement;
use Illuminate\Validation\ValidationException;

final class SafeXml
{
    public function load(string $xml): DOMDocument
    {
        if (strlen($xml) > 2 * 1024 * 1024 || str_contains($xml, "\0") || preg_match('/<!\s*(DOCTYPE|ENTITY)\b/i', $xml) === 1) {
            throw ValidationException::withMessages(['xml' => 'XML exceeds the size limit or contains a forbidden declaration.']);
        }
        $previous = libxml_use_internal_errors(true);
        $previousLoader = libxml_get_external_entity_loader();
        libxml_set_external_entity_loader(static fn (): null => null);
        libxml_clear_errors();
        try {
            $document = new DOMDocument;
            $document->resolveExternals = false;
            $document->substituteEntities = false;
            if (! $document->loadXML($xml, LIBXML_NONET | LIBXML_NOBLANKS | LIBXML_COMPACT) || $document->doctype !== null || ! $document->documentElement instanceof DOMElement) {
                throw ValidationException::withMessages(['xml' => 'The XML document is not well formed.']);
            }
            $count = 0;
            $this->bound($document->documentElement, 1, $count);

            return $document;
        } finally {
            libxml_set_external_entity_loader($previousLoader);
            libxml_clear_errors();
            libxml_use_internal_errors($previous);
        }
    }

    private function bound(DOMElement $element, int $depth, int &$count): void
    {
        if (++$count > 50000 || $depth > 64) {
            throw ValidationException::withMessages(['xml' => 'The XML structure exceeds the element or depth limit.']);
        }
        foreach ($element->childNodes as $child) {
            if ($child instanceof DOMElement) {
                $this->bound($child, $depth + 1, $count);
            }
        }
    }
}
