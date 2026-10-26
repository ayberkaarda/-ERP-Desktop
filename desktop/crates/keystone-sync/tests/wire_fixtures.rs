//! Every `contracts/sync/fixtures/*.json` must be valid against its schema
//! and survive deserialize -> serialize through the wire types unchanged.
//! Every `fixtures/invalid/*.json` of a sync schema must be rejected.

use std::fs;
use std::path::{Path, PathBuf};

use jsonschema::{Registry, Validator};
use keystone_sync::wire::{
    CommonSamples, DeviceLoginRequest, DeviceRefreshRequest, DeviceTokenResponse, ErrorCode,
    ErrorResponse, ManifestResponse, PullRequest, PullResponse, PushRequest, PushResponse,
    SCHEMA_DIGESTS, Tombstone,
};
use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::Value;

const BASE_URI: &str = "https://keystone-erp.invalid/contracts/sync/";

fn sync_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../contracts/sync")
}

fn read_json(path: &Path) -> Value {
    let text = fs::read_to_string(path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

fn schema_names() -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(sync_dir())
        .expect("contracts/sync")
        .map(|e| e.expect("entry").file_name().into_string().expect("utf-8"))
        .filter(|n| n.ends_with(".schema.json"))
        .collect();
    names.sort();
    names
}

fn validator(schema: &str) -> Validator {
    let mut registry = Registry::new();
    for name in schema_names() {
        let uri = format!("{BASE_URI}{name}");
        registry = registry
            .add(uri, read_json(&sync_dir().join(&name)))
            .expect("register schema");
    }
    let registry = registry.prepare().expect("prepare registry");
    jsonschema::options()
        .with_registry(&registry)
        .build(&serde_json::json!({ "$ref": format!("{BASE_URI}{schema}") }))
        .unwrap_or_else(|e| panic!("{schema}: {e}"))
}

/// Fixture name prefix (before the first '.') to schema file.
fn schema_for(fixture: &str) -> String {
    let prefix = fixture.split('.').next().expect("name");
    let candidates = [
        format!("{prefix}.schema.json"),
        format!(
            "{prefix}.{}.schema.json",
            fixture.split('.').nth(1).expect("kind")
        ),
    ];
    candidates
        .into_iter()
        .find(|c| sync_dir().join(c).is_file())
        .unwrap_or_else(|| panic!("no schema for {fixture}"))
}

fn round_trip<T: Serialize + DeserializeOwned>(value: &Value) -> Value {
    let typed: T = serde_json::from_value(value.clone()).expect("deserialize");
    serde_json::to_value(&typed).expect("serialize")
}

/// Schema file to the round-trip function of its wire type.
fn round_trip_for(schema: &str) -> fn(&Value) -> Value {
    match schema {
        "common.schema.json" => round_trip::<CommonSamples>,
        "device-login.request.schema.json" => round_trip::<DeviceLoginRequest>,
        "device-refresh.request.schema.json" => round_trip::<DeviceRefreshRequest>,
        "device-token.response.schema.json" => round_trip::<DeviceTokenResponse>,
        "error-codes.schema.json" => round_trip::<ErrorCode>,
        "error.response.schema.json" => round_trip::<ErrorResponse>,
        "manifest.response.schema.json" => round_trip::<ManifestResponse>,
        "pull.request.schema.json" => round_trip::<PullRequest>,
        "pull.response.schema.json" => round_trip::<PullResponse>,
        "push.request.schema.json" => round_trip::<PushRequest>,
        "push.response.schema.json" => round_trip::<PushResponse>,
        "tombstone.schema.json" => round_trip::<Tombstone>,
        other => panic!("no wire type for {other}"),
    }
}

fn fixtures(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .expect("fixtures")
        .map(|e| e.expect("entry"))
        .filter(|e| e.file_type().expect("type").is_file())
        .map(|e| e.file_name().into_string().expect("utf-8"))
        .filter(|n| n.ends_with(".json"))
        .collect();
    names.sort();
    names
}

#[test]
fn every_schema_has_a_wire_type() {
    for schema in schema_names() {
        round_trip_for(&schema);
    }
}

#[test]
fn valid_fixtures_match_schema_and_round_trip() {
    let dir = sync_dir().join("fixtures");
    let names = fixtures(&dir);
    assert!(
        names.len() >= 16,
        "expected the D0 fixture set, got {names:?}"
    );
    for name in names {
        let schema = schema_for(&name);
        let value = read_json(&dir.join(&name));
        let errors: Vec<String> = validator(&schema)
            .iter_errors(&value)
            .map(|e| format!("{} at {}", e, e.instance_path()))
            .collect();
        assert!(errors.is_empty(), "{name} vs {schema}: {errors:#?}");
        let back = round_trip_for(&schema)(&value);
        assert_eq!(back, value, "{name} changed in a round trip");
    }
}

#[test]
fn invalid_sync_fixtures_are_rejected_by_their_schema() {
    let dir = sync_dir().join("fixtures/invalid");
    let mut checked = 0;
    for name in fixtures(&dir) {
        // offline-manifest.* belong to contracts/offline-manifest.schema.json.
        if name.starts_with("offline-manifest.") {
            continue;
        }
        let schema = schema_for(&name);
        let value = read_json(&dir.join(&name));
        assert!(
            !validator(&schema).is_valid(&value),
            "{name} passed {schema}"
        );
        checked += 1;
    }
    assert!(checked > 0);
}

#[test]
fn schema_digest_table_lists_every_schema() {
    let listed: Vec<&str> = SCHEMA_DIGESTS.iter().map(|(name, _)| *name).collect();
    assert_eq!(listed, schema_names());
}

#[test]
fn error_codes_match_the_schema() {
    let schema = read_json(&sync_dir().join("error-codes.schema.json"));
    let wire: Vec<&str> = schema["oneOf"]
        .as_array()
        .expect("oneOf")
        .iter()
        .map(|entry| entry["const"].as_str().expect("const"))
        .collect();
    let ours: Vec<&str> = ErrorCode::ALL.iter().map(|c| c.as_str()).collect();
    assert_eq!(ours, wire);
}
