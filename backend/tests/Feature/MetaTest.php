<?php

declare(strict_types=1);

it('returns public server metadata in the standard envelope', function (): void {
    config([
        'app.name' => 'ERP Server',
        'desktop.version' => '2.4.0',
        'desktop.api_version' => 'v1',
        'broadcasting.connections.reverb.options.host' => 'socket.example.test',
        'broadcasting.connections.reverb.options.port' => '9443',
        'broadcasting.connections.reverb.options.scheme' => 'wss',
        'broadcasting.connections.reverb.key' => 'public-key',
        'broadcasting.connections.reverb.secret' => 'private-secret',
        'desktop.min_version' => '1.2.0',
        'desktop.update_channel' => 'beta',
        'desktop.schema_version' => 7,
        'desktop.min_schema_version' => 5,
    ]);

    $this->getJson('/api/v1/meta')
        ->assertOk()
        ->assertJsonPath('data.name', 'ERP Server')
        ->assertJsonPath('data.version', '2.4.0')
        ->assertJsonPath('data.api_version', 'v1')
        ->assertJsonPath('data.reverb.host', 'socket.example.test')
        ->assertJsonPath('data.reverb.port', 9443)
        ->assertJsonPath('data.reverb.scheme', 'wss')
        ->assertJsonPath('data.reverb.key', 'public-key')
        ->assertJsonPath('data.desktop.min_version', '1.2.0')
        ->assertJsonPath('data.desktop.update_channel', 'beta')
        ->assertJsonPath('data.sync.schema_version', 7)
        ->assertJsonPath('data.sync.min_schema_version', 5)
        ->assertJsonMissingPath('data.reverb.secret')
        ->assertJsonMissing(['private-secret'])
        ->assertJsonStructure(['data' => [
            'name', 'version', 'api_version', 'reverb' => ['host', 'port', 'scheme', 'key'],
            'desktop' => ['min_version', 'update_channel'],
            'sync' => ['schema_version', 'min_schema_version'],
        ]]);
});
