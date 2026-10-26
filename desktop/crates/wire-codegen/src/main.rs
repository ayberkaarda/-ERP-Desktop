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
    let mut s = String::from(HEADER);
    s.push_str(
        "\nuse serde::{Deserialize, Serialize};\n\n\
         /// Values of `errors.code` (`contracts/sync/error-codes.schema.json`).\n\
         #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]\n\
         pub enum ErrorCode {\n",
    );
    for code in &codes {
        for line in code.description.lines() {
            let _ = writeln!(s, "    /// {line}");
        }
        let _ = writeln!(s, "    #[serde(rename = \"{}\")]", code.wire);
        let _ = writeln!(s, "    {},", code.variant);
    }
    s.push_str("}\n\nimpl ErrorCode {\n    /// Every code, in schema order.\n    pub const ALL: &[Self] = &[\n");
    for code in &codes {
        let _ = writeln!(s, "        Self::{},", code.variant);
    }
    s.push_str("    ];\n\n    /// The wire spelling.\n    pub const fn as_str(self) -> &'static str {\n        match self {\n");
    for code in &codes {
        let _ = writeln!(
            s,
            "            Self::{} => \"{}\",",
            code.variant, code.wire
        );
    }
    s.push_str(
        "        }\n    }\n\n    /// HTTP status used when the code is returned at request level.\n    \
         /// `None` for codes that only appear inside push results.\n    \
         pub const fn http_status(self) -> Option<u16> {\n        match self {\n",
    );
    for code in &codes {
        let status = code
            .status
            .map_or_else(|| "None".to_owned(), |v| format!("Some({v})"));
        let _ = writeln!(s, "            Self::{} => {status},", code.variant);
    }
    s.push_str(
        "        }\n    }\n\n    /// Marked \"Önerilen\" in the schema: added for sync, not yet in the server `ErrorCode`.\n    \
         pub const fn is_proposed(self) -> bool {\n        match self {\n",
    );
    for code in &codes {
        let _ = writeln!(
            s,
            "            Self::{} => {},",
            code.variant, code.proposed
        );
    }
    s.push_str("        }\n    }\n}\n\nimpl std::fmt::Display for ErrorCode {\n    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {\n        f.write_str(self.as_str())\n    }\n}\n");
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
