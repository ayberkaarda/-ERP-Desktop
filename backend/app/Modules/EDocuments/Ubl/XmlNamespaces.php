<?php

declare(strict_types=1);

namespace App\Modules\EDocuments\Ubl;

final class XmlNamespaces
{
    public const string INVOICE = 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2';

    public const string DESPATCH = 'urn:oasis:names:specification:ubl:schema:xsd:DespatchAdvice-2';

    public const string CBC = 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2';

    public const string CAC = 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2';

    public const string EXT = 'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2';

    public const string XSI = 'http://www.w3.org/2001/XMLSchema-instance';

    public const string SANDBOX = 'urn:keystone:edocuments:sandbox';
}
