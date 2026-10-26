//! Writes the parts of `keystone-sync::wire` that come straight from
//! `contracts/sync`: the `ErrorCode` enum and the schema digest table.
//!
//! The remaining wire types are hand-written serde types (typify cannot read
//! these schemas: cross-file `$ref` and `if/then/else` are unsupported, and it
//! drops explicit `null` on optional nullable fields). The digest table makes
//! every schema edit show up as a diff here, so the hand-written types get
//! reviewed together with the schema change.
//!
//! Usage: `keystone-wire-codegen [--contracts <dir>] [--out <dir>]`.

#![forbid(unsafe_code)]

use std::fmt::Write as _;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use serde_json::Value;
use sha2::{Digest, Sha256};

const HEADER: &str =
    "// Produced by desktop/scripts/gen-wire.sh from contracts/sync. Do not edit by hand.\n";

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("keystone-wire-codegen: {message}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<(), String> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let mut contracts = manifest_dir.join("../../../contracts/sync");
    let mut out = manifest_dir.join("../keystone-sync/src/wire/from_schema");

    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        let value = args.next().ok_or_else(|| format!("{arg} needs a value"))?;
        match arg.as_str() {
            "--contracts" => contracts = PathBuf::from(value),
            "--out" => out = PathBuf::from(value),
            _ => return Err(format!("unknown argument {arg}")),
        }
    }

    let error_codes = read_json(&contracts.join("error-codes.schema.json"))?;
    fs::create_dir_all(&out).map_err(|e| format!("{}: {e}", out.display()))?;
    write(&out.join("error_code.rs"), &error_code_rs(&error_codes)?)?;
    write(
        &out.join("schema_digest.rs"),
        &schema_digest_rs(&contracts)?,
    )?;
    Ok(())
}

fn read_json(path: &Path) -> Result<Value, String> {
    let text = fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
    serde_json::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))
}

fn write(path: &Path, contents: &str) -> Result<(), String> {
    fs::write(path, contents).map_err(|e| format!("{}: {e}", path.display()))
}

struct Code {
    wire: String,
    variant: String,
    description: String,
    status: Option<u16>,
    proposed: bool,
}

fn parse_codes(schema: &Value) -> Result<Vec<Code>, String> {
    let entries = schema
        .get("oneOf")
        .and_then(Value::as_array)
        .ok_or("error-codes.schema.json: oneOf array missing")?;
    entries
        .iter()
        .map(|entry| {
            let wire = entry
                .get("const")
                .and_then(Value::as_str)
                .ok_or("error-codes.schema.json: oneOf entry without string const")?;
            let description = entry
                .get("description")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned();
            let rest = description.strip_prefix("Önerilen. ");
            let proposed = rest.is_some();
            let rest = rest.unwrap_or(&description);
            let status = rest
                .get(..4)
                .filter(|head| head.ends_with('.'))
                .and_then(|head| head[..3].parse::<u16>().ok());
            Ok(Code {
                variant: pascal_case(wire)?,
                wire: wire.to_owned(),
                description,
                status,
                proposed,
            })
        })
        .collect()
}

fn pascal_case(wire: &str) -> Result<String, String> {
    if wire.is_empty()
        || !wire
            .chars()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
    {
        return Err(format!("error code {wire:?} is not SCREAMING_SNAKE_CASE"));
    }
    Ok(wire
        .split('_')
        .filter(|part| !part.is_empty())
        .map(|part| {
            let lower = part.to_ascii_lowercase();
            let mut chars = lower.chars();
            chars
                .next()
                .map(|first| first.to_ascii_uppercase().to_string() + chars.as_str())
                .unwrap_or_default()
        })
        .collect())
}

fn error_code_rs(schema: &Value) -> Result<String, String> {
    let codes = parse_codes(schema)?;
    if codes.iter().any(|code| code.variant == "Unknown") {
        return Err("error code UNKNOWN collides with the ErrorCode::Unknown fallback".into());
    }
    let mut s = String::from(HEADER);
    s.push_str(
        "\nuse serde::{Deserialize, Deserializer, Serialize, Serializer};\n\n\
         /// Values of `errors.code` (`contracts/sync/error-codes.schema.json`).\n\
         ///\n\
         /// A code missing from the schema (a newer server) decodes to [`ErrorCode::Unknown`]\n\
         /// instead of failing, and counts as a generic server error.\n\
         #[derive(Clone, PartialEq, Eq, Hash)]\n\
         pub enum ErrorCode {\n",
    );
    for code in &codes {
        for line in code.description.lines() {
            let _ = writeln!(s, "    /// {line}");
        }
        if !code.description.is_empty() {
            s.push_str("    ///\n");
        }
        let _ = writeln!(s, "    /// Wire: `{}`.", code.wire);
        let _ = writeln!(s, "    {},", code.variant);
    }
    s.push_str(
        "    /// A code this client does not know, kept verbatim.\n    Unknown(String),\n}\n\n\
         impl ErrorCode {\n    /// Every known code, in schema order.\n    pub const ALL: &[Self] = &[\n",
    );
    for code in &codes {
        let _ = writeln!(s, "        Self::{},", code.variant);
    }
    s.push_str(
        "    ];\n\n    /// Parses a wire code; anything unknown becomes [`ErrorCode::Unknown`].\n    \
         pub fn from_wire(code: &str) -> Self {\n        match code {\n",
    );
    for code in &codes {
        let _ = writeln!(
            s,
            "            \"{}\" => Self::{},",
            code.wire, code.variant
        );
    }
    s.push_str(
        "            other => Self::Unknown(other.to_owned()),\n        }\n    }\n\n    \
         /// The wire spelling (the original text for [`ErrorCode::Unknown`]).\n    \
         pub fn as_str(&self) -> &str {\n        match self {\n            \
         Self::Unknown(code) => code,\n            known => known.ui_code(),\n        }\n    }\n\n    \
         /// Code the UI translates: the wire spelling, or `SERVER_ERROR` for an unknown code.\n    \
         pub const fn ui_code(&self) -> &'static str {\n        match self {\n",
    );
    for code in &codes {
        let _ = writeln!(
            s,
            "            Self::{} => \"{}\",",
            code.variant, code.wire
        );
    }
    s.push_str(
        "            Self::Unknown(_) => \"SERVER_ERROR\",\n        }\n    }\n\n    \
         /// False only for [`ErrorCode::Unknown`].\n    \
         pub const fn is_known(&self) -> bool {\n        !matches!(self, Self::Unknown(_))\n    }\n\n    \
         /// HTTP status used when the code is returned at request level.\n    \
         /// `None` for codes that only appear inside push results, and for unknown codes.\n    \
         pub const fn http_status(&self) -> Option<u16> {\n        match self {\n",
    );
    for code in &codes {
        let status = code
            .status
            .map_or_else(|| "None".to_owned(), |v| format!("Some({v})"));
        let _ = writeln!(s, "            Self::{} => {status},", code.variant);
    }
    s.push_str(
        "            Self::Unknown(_) => None,\n        }\n    }\n\n    \
         /// Marked \"Önerilen\" in the schema: added for sync, not yet in the server `ErrorCode`.\n    \
         pub const fn is_proposed(&self) -> bool {\n        match self {\n",
    );
    for code in &codes {
        let _ = writeln!(
            s,
            "            Self::{} => {},",
            code.variant, code.proposed
        );
    }
    s.push_str(
        "            Self::Unknown(_) => false,\n        }\n    }\n}\n\n\
         /// An unknown code is never shown: server text in that position could\n\
         /// carry anything. Use [`ErrorCode::as_str`] to get it on purpose.\n\
         impl std::fmt::Display for ErrorCode {\n    \
         fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {\n        \
         match self {\n            \
         Self::Unknown(_) => f.write_str(\"<redacted>\"),\n            \
         known => f.write_str(known.ui_code()),\n        }\n    }\n}\n\n\
         impl std::fmt::Debug for ErrorCode {\n    \
         fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {\n        \
         match self {\n            \
         Self::Unknown(_) => f.write_str(\"Unknown(<redacted>)\"),\n            \
         known => f.write_str(known.ui_code()),\n        }\n    }\n}\n\n\
         impl Serialize for ErrorCode {\n    \
         fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {\n        \
         serializer.serialize_str(self.as_str())\n    }\n}\n\n\
         impl<'de> Deserialize<'de> for ErrorCode {\n    \
         fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {\n        \
         String::deserialize(deserializer).map(|code| Self::from_wire(&code))\n    }\n}\n",
    );
    Ok(s)
}

fn schema_digest_rs(contracts: &Path) -> Result<String, String> {
    let mut names: Vec<String> = fs::read_dir(contracts)
        .map_err(|e| format!("{}: {e}", contracts.display()))?
        .filter_map(Result::ok)
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter(|name| name.ends_with(".schema.json"))
        .collect();
    names.sort();

    let mut s = String::from(HEADER);
    s.push_str(
        "\n/// SHA-256 of each `contracts/sync/*.schema.json` (LF line endings).\n\
         /// A schema edit changes this table; review the hand-written wire types with it.\n\
         pub const SCHEMA_DIGESTS: &[(&str, &str)] = &[\n",
    );
    for name in &names {
        let bytes = fs::read(contracts.join(name)).map_err(|e| format!("{name}: {e}"))?;
        let normalized: Vec<u8> = strip_cr(&bytes);
        let digest = Sha256::digest(&normalized);
        let hex: String = digest.iter().map(|b| format!("{b:02x}")).collect();
        let _ = writeln!(s, "    (\n        \"{name}\",\n        \"{hex}\",\n    ),");
    }
    s.push_str("];\n");
    Ok(s)
}

fn strip_cr(bytes: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(bytes.len());
    let mut iter = bytes.iter().peekable();
    while let Some(&b) = iter.next() {
        if b == b'\r' && iter.peek() == Some(&&b'\n') {
            continue;
        }
        out.push(b);
    }
    out
}
