<?php

declare(strict_types=1);

/** Explicit provisioning only; application requests never download validation dependencies. */
$resources = dirname(__DIR__).'/app/Modules/EDocuments/Resources';
$manifest = json_decode((string) file_get_contents($resources.'/runtime-manifest.json'), true, flags: JSON_THROW_ON_ERROR);
$target = dirname(__DIR__).'/storage/app/edocuments/runtime';
if (! is_dir($target) && ! mkdir($target, 0755, true) && ! is_dir($target)) {
    throw new RuntimeException('Cannot create the electronic document runtime directory.');
}
$verifyOnly = in_array('--verify-only', $argv, true);
foreach ($manifest['artifacts'] as $artifact) {
    $file = $target.'/'.$artifact['name'];
    if (is_file($file) && hash_equals($artifact['sha256'], (string) hash_file('sha256', $file))) {
        fwrite(STDOUT, 'Verified '.$artifact['name'].PHP_EOL);

        continue;
    }
    if ($verifyOnly) {
        throw new RuntimeException('Missing or invalid validation dependency: '.$artifact['name']);
    }
    $temporary = tempnam($target, 'download-');
    if ($temporary === false) {
        throw new RuntimeException('Cannot create a runtime download file.');
    }
    try {
        $curl = PHP_OS_FAMILY === 'Windows' ? (getenv('SystemRoot') ?: 'C:/Windows').'/System32/curl.exe' : null;
        if ($curl !== null && is_file($curl)) {
            $process = proc_open([$curl, '--fail', '--location', '--proto', '=https', '--tlsv1.2', '--max-time', '90', '--silent', '--show-error', '--output', $temporary, $artifact['url']], [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
            if (! is_resource($process)) {
                throw new RuntimeException('Cannot start the HTTPS downloader.');
            }
            fclose($pipes[0]);
            stream_get_contents($pipes[1]);
            fclose($pipes[1]);
            $error = stream_get_contents($pipes[2]);
            fclose($pipes[2]);
            if (proc_close($process) !== 0) {
                throw new RuntimeException('Validation dependency download failed: '.$error);
            }
        } else {
            $context = stream_context_create(['http' => ['timeout' => 90], 'ssl' => ['verify_peer' => true, 'verify_peer_name' => true]]);
            $source = fopen($artifact['url'], 'rb', false, $context);
            $destination = fopen($temporary, 'wb');
            if ($source === false || $destination === false) {
                throw new RuntimeException('Cannot open the HTTPS validation dependency download.');
            }
            stream_copy_to_stream($source, $destination, 20 * 1024 * 1024);
            fclose($source);
            fclose($destination);
        }
        if (! hash_equals($artifact['sha256'], (string) hash_file('sha256', $temporary))) {
            throw new RuntimeException('Validation dependency checksum mismatch: '.$artifact['name']);
        }
        if (! rename($temporary, $file)) {
            throw new RuntimeException('Cannot install validation dependency: '.$artifact['name']);
        }
        fwrite(STDOUT, 'Installed '.$artifact['name'].PHP_EOL);
    } finally {
        if (is_file($temporary)) {
            unlink($temporary);
        }
    }
}
