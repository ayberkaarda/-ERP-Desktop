//! Server profiles: `profiles.json` in the app data directory.
//!
//! One file, `{"version": 1, "active": id?, "profiles": [..]}`, holding no
//! secret: tokens and database keys live in the OS keychain under the
//! profile id. A profile is the server's base URL, the `/api/v1/meta` it
//! answered when it was added (`meta_snapshot`), the chosen company and a
//! display name.
//!
//! Every change is a read-modify-write under one lock, written to a
//! temporary file and renamed over the old one, so a crash leaves either
//! the old or the new file. A file that cannot be read is never written
//! over: the commands fail with `PROFILES_FILE_INVALID` instead.

use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};

use keystone_sync::wire::{SchemaVersion, ServerMeta};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::bootstrap::codes;
use crate::commands::{CommandError, CommandResult};

/// File name inside the app data directory.
pub const FILE_NAME: &str = "profiles.json";

const VERSION: u32 = 1;

/// One server profile as stored.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Profile {
    /// UUIDv7; also the keychain account of the profile's session record
    /// and the name of its data directory.
    pub id: String,
    pub name: String,
    /// `scheme://host[:port]`, as `ServerUrl::origin` gives it.
    pub base_url: String,
    pub meta_snapshot: MetaSnapshot,
    /// Company the profile works in; `None` until chosen after sign-in.
    #[serde(default)]
    pub company_id: Option<Uuid>,
    /// RFC 3339, UTC.
    pub created_at: String,
}

/// The parts of `/api/v1/meta` the shell keeps (and the realtime bridge
/// reads: `reverb`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MetaSnapshot {
    pub name: String,
    pub version: String,
    pub reverb: ReverbSnapshot,
    pub desktop: DesktopSnapshot,
    pub sync: SyncSnapshot,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReverbSnapshot {
    pub host: Option<String>,
    pub port: Option<u16>,
    pub scheme: Option<String>,
    pub key: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesktopSnapshot {
    pub min_version: Option<String>,
    pub update_channel: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct SyncSnapshot {
    pub schema_version: SchemaVersion,
    pub min_schema_version: SchemaVersion,
}

impl From<&ServerMeta> for MetaSnapshot {
    fn from(meta: &ServerMeta) -> Self {
        Self {
            name: meta.name.clone(),
            version: meta.version.clone(),
            reverb: ReverbSnapshot {
                host: meta.reverb.host.clone(),
                port: meta.reverb.port,
                scheme: meta.reverb.scheme.clone(),
                key: meta.reverb.key.clone(),
            },
            desktop: DesktopSnapshot {
                min_version: meta.desktop.min_version.clone(),
                update_channel: meta.desktop.update_channel.clone(),
            },
            sync: SyncSnapshot {
                schema_version: meta.sync.schema_version,
                min_schema_version: meta.sync.min_schema_version,
            },
        }
    }
}

/// The whole file.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct ProfilesFile {
    #[serde(default = "version")]
    pub version: u32,
    #[serde(default)]
    pub active: Option<String>,
    #[serde(default)]
    pub profiles: Vec<Profile>,
}

fn version() -> u32 {
    VERSION
}

impl ProfilesFile {
    pub fn get(&self, id: &str) -> Option<&Profile> {
        self.profiles.iter().find(|p| p.id == id)
    }

    fn get_mut(&mut self, id: &str) -> CommandResult<&mut Profile> {
        self.profiles
            .iter_mut()
            .find(|p| p.id == id)
            .ok_or_else(|| not_found(id))
    }
}

/// `profiles.json` of one data directory.
#[derive(Debug)]
pub struct ProfileRegistry {
    path: PathBuf,
    lock: Mutex<()>,
}

impl ProfileRegistry {
    pub fn new(data_dir: &Path) -> Self {
        Self {
            path: data_dir.join(FILE_NAME),
            lock: Mutex::new(()),
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// The file as stored; empty when there is none yet.
    pub fn load(&self) -> CommandResult<ProfilesFile> {
        let _guard = self.lock.lock().unwrap_or_else(PoisonError::into_inner);
        self.read()
    }

    pub fn get(&self, id: &str) -> CommandResult<Profile> {
        self.load()?.get(id).cloned().ok_or_else(|| not_found(id))
    }

    pub fn add(&self, profile: Profile) -> CommandResult<()> {
        self.update(|file| {
            file.profiles.push(profile);
            Ok(())
        })
    }

    /// Removes the profile (and the active mark when it was active).
    pub fn remove(&self, id: &str) -> CommandResult<()> {
        self.update(|file| {
            let before = file.profiles.len();
            file.profiles.retain(|p| p.id != id);
            if file.profiles.len() == before {
                return Err(not_found(id));
            }
            if file.active.as_deref() == Some(id) {
                file.active = None;
            }
            Ok(())
        })
    }

    pub fn set_active(&self, id: Option<&str>) -> CommandResult<()> {
        self.update(|file| {
            if let Some(id) = id {
                file.get_mut(id)?;
            }
            file.active = id.map(str::to_owned);
            Ok(())
        })
    }

    pub fn set_company(&self, id: &str, company: Option<Uuid>) -> CommandResult<Profile> {
        let mut changed = None;
        self.update(|file| {
            let profile = file.get_mut(id)?;
            profile.company_id = company;
            changed = Some(profile.clone());
            Ok(())
        })?;
        changed.ok_or_else(|| not_found(id))
    }

    fn update(
        &self,
        change: impl FnOnce(&mut ProfilesFile) -> CommandResult<()>,
    ) -> CommandResult<()> {
        let _guard = self.lock.lock().unwrap_or_else(PoisonError::into_inner);
        let mut file = self.read()?;
        change(&mut file)?;
        self.write(&file)
    }

    fn read(&self) -> CommandResult<ProfilesFile> {
        let bytes = match std::fs::read(&self.path) {
            Ok(bytes) => bytes,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return Ok(ProfilesFile {
                    version: VERSION,
                    ..ProfilesFile::default()
                });
            }
            Err(e) => return Err(io_error("read", &e)),
        };
        let file: ProfilesFile = serde_json::from_slice(&bytes)
            .map_err(|_| invalid_file("the profile file is not valid JSON of this version"))?;
        if file.version != VERSION {
            return Err(invalid_file("the profile file has an unknown version"));
        }
        Ok(file)
    }

    fn write(&self, file: &ProfilesFile) -> CommandResult<()> {
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| io_error("create the directory of", &e))?;
        }
        let text = serde_json::to_vec_pretty(file)
            .map_err(|_| CommandError::new(codes::PROFILES_FILE_INVALID, "cannot encode"))?;
        let tmp = self.path.with_extension("json.tmp");
        std::fs::write(&tmp, text).map_err(|e| io_error("write", &e))?;
        std::fs::rename(&tmp, &self.path).map_err(|e| io_error("replace", &e))
    }
}

fn not_found(id: &str) -> CommandError {
    CommandError::new(
        codes::PROFILE_NOT_FOUND,
        format!("no server profile with id {id}"),
    )
}

fn invalid_file(message: &str) -> CommandError {
    CommandError::new(codes::PROFILES_FILE_INVALID, message)
}

fn io_error(what: &str, error: &std::io::Error) -> CommandError {
    CommandError::new(
        codes::PROFILES_FILE_INVALID,
        format!("cannot {what} the profile file: {}", error.kind()),
    )
}

/// Compares dotted numeric versions (`1.2.3`, a leading `v` and a
/// `-pre`/`+build` suffix are ignored; missing parts count as 0). `None`
/// when either side is not such a version.
pub fn compare_versions(a: &str, b: &str) -> Option<std::cmp::Ordering> {
    fn parts(v: &str) -> Option<Vec<u64>> {
        let v = v.trim();
        let v = v.strip_prefix(['v', 'V']).unwrap_or(v);
        let core = v.split(['-', '+']).next()?;
        if core.is_empty() {
            return None;
        }
        core.split('.').map(|p| p.parse::<u64>().ok()).collect()
    }
    let (mut a, mut b) = (parts(a)?, parts(b)?);
    let len = a.len().max(b.len());
    a.resize(len, 0);
    b.resize(len, 0);
    Some(a.cmp(&b))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cmp::Ordering;

    fn profile(id: &str) -> Profile {
        Profile {
            id: id.into(),
            name: format!("Server {id}"),
            base_url: "https://erp.example.com".into(),
            meta_snapshot: MetaSnapshot {
                name: "Keystone".into(),
                version: "1.4.0".into(),
                reverb: ReverbSnapshot {
                    host: Some("ws.example.com".into()),
                    port: Some(443),
                    scheme: Some("https".into()),
                    key: Some("public-key".into()),
                },
                desktop: DesktopSnapshot {
                    min_version: Some("0.1.0".into()),
                    update_channel: None,
                },
                sync: SyncSnapshot {
                    schema_version: 1,
                    min_schema_version: 1,
                },
            },
            company_id: None,
            created_at: "2026-10-27T09:00:00Z".into(),
        }
    }

    #[test]
    fn profiles_round_trip_through_the_file() {
        let dir = tempfile::tempdir().unwrap();
        let registry = ProfileRegistry::new(dir.path());
        assert_eq!(registry.load().unwrap().profiles, []);

        registry.add(profile("a")).unwrap();
        registry.add(profile("b")).unwrap();
        registry.set_active(Some("b")).unwrap();
        let company = Uuid::now_v7();
        registry.set_company("a", Some(company)).unwrap();

        // A fresh registry over the same directory reads the same file.
        let again = ProfileRegistry::new(dir.path()).load().unwrap();
        assert_eq!(again.active.as_deref(), Some("b"));
        assert_eq!(again.profiles.len(), 2);
        assert_eq!(again.get("a").unwrap().company_id, Some(company));
        assert_eq!(again.get("b").unwrap(), &profile("b"));

        registry.remove("b").unwrap();
        let after = registry.load().unwrap();
        assert_eq!(after.active, None);
        assert_eq!(after.profiles.len(), 1);
        assert!(!dir.path().join("profiles.json.tmp").exists());
    }

    #[test]
    fn the_file_holds_no_secret_fields() {
        let dir = tempfile::tempdir().unwrap();
        let registry = ProfileRegistry::new(dir.path());
        registry.add(profile("a")).unwrap();
        let text = std::fs::read_to_string(registry.path()).unwrap();
        for word in ["token", "password", "key\":\"0", "db_key", "fingerprint"] {
            assert!(!text.contains(word), "{word} in {text}");
        }
    }

    #[test]
    fn an_unreadable_file_is_reported_and_never_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        let registry = ProfileRegistry::new(dir.path());
        std::fs::write(registry.path(), b"{not json").unwrap();
        assert_eq!(
            registry.load().unwrap_err().code,
            codes::PROFILES_FILE_INVALID
        );
        assert_eq!(
            registry.add(profile("a")).unwrap_err().code,
            codes::PROFILES_FILE_INVALID
        );
        assert_eq!(std::fs::read(registry.path()).unwrap(), b"{not json");

        std::fs::write(registry.path(), br#"{"version": 9, "profiles": []}"#).unwrap();
        assert_eq!(
            registry.load().unwrap_err().code,
            codes::PROFILES_FILE_INVALID
        );
    }

    #[test]
    fn unknown_ids_are_not_found() {
        let dir = tempfile::tempdir().unwrap();
        let registry = ProfileRegistry::new(dir.path());
        assert_eq!(
            registry.set_active(Some("x")).unwrap_err().code,
            codes::PROFILE_NOT_FOUND
        );
        assert_eq!(
            registry.remove("x").unwrap_err().code,
            codes::PROFILE_NOT_FOUND
        );
        assert_eq!(
            registry.get("x").unwrap_err().code,
            codes::PROFILE_NOT_FOUND
        );
    }

    #[test]
    fn versions_compare_numerically() {
        assert_eq!(compare_versions("0.10.0", "0.9.9"), Some(Ordering::Greater));
        assert_eq!(compare_versions("1.2", "1.2.0"), Some(Ordering::Equal));
        assert_eq!(
            compare_versions("v1.2.3-beta.1", "1.2.3"),
            Some(Ordering::Equal)
        );
        assert_eq!(compare_versions("0.1.0", "1.0.0"), Some(Ordering::Less));
        assert_eq!(compare_versions("latest", "1.0.0"), None);
        assert_eq!(compare_versions("", "1.0.0"), None);
    }
}
