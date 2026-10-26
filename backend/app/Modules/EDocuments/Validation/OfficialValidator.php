<?php

declare(strict_types=1);

namespace App\Modules\EDocuments\Validation;

use App\Modules\EDocuments\Data\XmlValidationResult;
use App\Modules\EDocuments\Ubl\XmlNamespaces;
use DOMDocument;
use DOMElement;
use DOMXPath;
use Illuminate\Validation\ValidationException;
use Symfony\Component\Process\Process;
use Throwable;

final class OfficialValidator
{
    public function __construct(private readonly SafeXml $safe, private readonly ResourceManifest $manifest, private readonly MonetaryRules $monetary) {}

    public function available(): bool
    {
        try {
            if (! $this->manifest->valid()) {
                return false;
            }
            $resources = dirname(__DIR__).'/Resources';
            $manifest = json_decode((string) file_get_contents($resources.'/runtime-manifest.json'), true, flags: JSON_THROW_ON_ERROR);
            foreach ($manifest['artifacts'] as $artifact) {
                $path = storage_path('app/edocuments/runtime/'.$artifact['name']);
                if (! is_file($path) || ! hash_equals($artifact['sha256'], (string) hash_file('sha256', $path))) {
                    return false;
                }
            }
            $process = new Process([(string) config('edocuments.java_binary', 'java'), '--list-modules']);
            $process->setTimeout(5);
            $process->mustRun();

            return str_contains($process->getOutput(), 'jdk.compiler@');
        } catch (Throwable) {
            return false;
        }
    }

    public function validate(string $xml, string $kind): XmlValidationResult
    {
        $resources = dirname(__DIR__).'/Resources';
        $metadata = ['ubl_version' => '2.1', 'customization_id' => 'TR1.2.1', 'schematron_revision' => '20260701', 'signature_verified' => false, 'validation_timezone' => 'Europe/Istanbul'];
        $warnings = ['This checks XML structure and official business rules, not electronic signature authenticity or legal delivery.'];
        if (! $this->manifest->valid()) {
            return new XmlValidationResult(false, false, [['layer' => 'resources', 'code' => 'VALIDATION_RESOURCES_INVALID', 'message' => 'The pinned official XML validation resources are missing or changed.']], $warnings, $metadata);
        }
        try {
            $document = $this->safe->load($xml);
        } catch (ValidationException $exception) {
            return new XmlValidationResult(true, false, [['layer' => 'security', 'code' => 'XML_UNSAFE', 'message' => $exception->getMessage()]], $warnings, $metadata);
        }
        $root = $document->documentElement;
        if (! $root instanceof DOMElement || ! in_array($kind, ['e_invoice', 'e_archive', 'e_despatch'], true) || $root->namespaceURI !== ($kind === 'e_despatch' ? XmlNamespaces::DESPATCH : XmlNamespaces::INVOICE)) {
            return new XmlValidationResult(true, false, [['layer' => 'document', 'code' => 'XML_KIND_MISMATCH', 'message' => 'The XML root does not match the selected document kind.']], $warnings, $metadata);
        }
        $xpath = new DOMXPath($document);
        $xpath->registerNamespace('cbc', XmlNamespaces::CBC);
        $profile = (string) $xpath->evaluate('string(/*/cbc:ProfileID)');
        if ($kind === 'e_archive' && $profile !== 'EARSIVFATURA' || $kind === 'e_invoice' && $profile === 'EARSIVFATURA') {
            return new XmlValidationResult(true, false, [['layer' => 'document', 'code' => 'XML_PROFILE_MISMATCH', 'message' => 'The XML profile does not match the selected document kind.']], $warnings, $metadata);
        }
        $schema = $resources.'/xsd/maindoc/UBL-'.($kind === 'e_despatch' ? 'DespatchAdvice' : 'Invoice').'-2.1.xsd';
        $metadata['xsd_sha256'] = hash_file('sha256', $schema);
        $metadata['schematron_sha256'] = hash_file('sha256', $resources.'/schematron/UBL-TR-20260701.xsl');
        $errors = $this->schema($document, $schema, $resources);
        if ($errors !== []) {
            return new XmlValidationResult(true, false, $errors, $warnings, [...$metadata, 'xsd_valid' => false, 'schematron_valid' => null]);
        }
        try {
            $errors = $this->schematron($xml, $kind === 'e_archive' ? 'earchive' : 'efatura', $resources);
        } catch (Throwable) {
            return new XmlValidationResult(false, false, [['layer' => 'runtime', 'code' => 'VALIDATION_UNAVAILABLE', 'message' => 'The pinned Java/Saxon validation runtime is unavailable. Provision the validation dependencies.']], $warnings, [...$metadata, 'xsd_valid' => true, 'schematron_valid' => null]);
        }

        $business = $this->monetary->errors($document);

        return new XmlValidationResult(true, $errors === [] && $business === [], [...$errors, ...$business], $warnings, [...$metadata, 'xsd_valid' => true, 'schematron_valid' => $errors === [], 'business_valid' => $business === []]);
    }

    /** @return list<array{layer:string,code:string,message:string,path?:string}> */
    private function schema(DOMDocument $document, string $schema, string $resources): array
    {
        $previousErrors = libxml_use_internal_errors(true);
        $previousLoader = libxml_get_external_entity_loader();
        libxml_clear_errors();
        $allowed = realpath($resources);
        libxml_set_external_entity_loader(static function (?string $public, string $system) use ($allowed) {
            $path = str_starts_with($system, 'file:///') ? rawurldecode(substr($system, PHP_OS_FAMILY === 'Windows' ? 8 : 7)) : $system;
            $real = realpath($path);
            if ($real === false && $allowed !== false && ! str_contains($path, ':')) {
                foreach (['maindoc', 'common'] as $directory) {
                    $candidate = realpath($allowed.'/xsd/'.$directory.'/'.$path);
                    if ($candidate !== false) {
                        $real = $candidate;
                        break;
                    }
                }
            }

            return $allowed !== false && $real !== false && str_ends_with($real, '.xsd') && str_starts_with($real, $allowed.DIRECTORY_SEPARATOR) ? fopen($real, 'rb') : null;
        });
        try {
            if (@$document->schemaValidate($schema)) {
                return [];
            }
            $errors = [];
            foreach (array_slice(libxml_get_errors(), 0, 50) as $error) {
                $errors[] = ['layer' => 'xsd', 'code' => 'XSD_'.$error->code, 'message' => mb_substr(trim($error->message), 0, 1000), 'path' => 'line:'.$error->line];
            }

            return $errors === [] ? [['layer' => 'xsd', 'code' => 'XSD_INVALID', 'message' => 'The XML schema validation failed.']] : $errors;
        } finally {
            libxml_set_external_entity_loader($previousLoader);
            libxml_clear_errors();
            libxml_use_internal_errors($previousErrors);
        }
    }

    /** @return list<array{layer:string,code:string,message:string,path?:string}> */
    private function schematron(string $xml, string $mode, string $resources): array
    {
        $runtime = storage_path('app/edocuments/runtime');
        $manifest = json_decode((string) file_get_contents($resources.'/runtime-manifest.json'), true, flags: JSON_THROW_ON_ERROR);
        $classpath = [];
        foreach ($manifest['artifacts'] as $artifact) {
            $path = $runtime.'/'.$artifact['name'];
            if (! is_file($path) || ! hash_equals($artifact['sha256'], (string) hash_file('sha256', $path))) {
                throw new \RuntimeException('Missing pinned runtime.');
            }
            $classpath[] = $path;
        }
        $input = tempnam($runtime, 'input-');
        $output = tempnam($runtime, 'result-');
        if ($input === false || $output === false) {
            throw new \RuntimeException('Cannot create validation workspace.');
        }
        try {
            file_put_contents($input, $xml);
            $process = new Process([(string) config('edocuments.java_binary', 'java'), '-Xmx256m', '--class-path', implode(PATH_SEPARATOR, $classpath), $resources.'/SecureSchematron.java', $input, $resources.'/schematron/UBL-TR-20260701.xsl', $output, $mode]);
            $process->setTimeout(30);
            $process->mustRun();
            $document = $this->safe->load((string) file_get_contents($output));
            $xpath = new DOMXPath($document);
            $xpath->registerNamespace('svrl', 'http://purl.oclc.org/dsdl/svrl');
            $errors = [];
            foreach ($xpath->query('//svrl:failed-assert') ?: [] as $assertion) {
                if ($assertion instanceof DOMElement && count($errors) < 50) {
                    $errors[] = ['layer' => 'schematron', 'code' => $assertion->getAttribute('id') ?: 'SCHEMATRON_ASSERT', 'message' => mb_substr(trim((string) $xpath->evaluate('string(svrl:text)', $assertion)), 0, 1000), 'path' => $assertion->getAttribute('location')];
                }
            }

            return $errors;
        } finally {
            unlink($input);
            unlink($output);
        }
    }
}
