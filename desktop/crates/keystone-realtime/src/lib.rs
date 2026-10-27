//! Reverb (Pusher protocol 7) client of the desktop shell: connection,
//! private channel authorization and event delivery.
//!
//! Scope (desktop D3, P7): one WebSocket to the server's Reverb, private
//! channels only (`private-user.{id}`), three user events
//! (`session.revoked`, `membership.revoked`, `notification.created`).
//! Resource changes are not broadcast by the server; the sync loop keeps its
//! own timer, realtime only triggers it. Presence channels are out of scope.
//!
//! - [`RealtimeConfig::from_params`] turns the `reverb` block of the server
//!   meta into a socket URL. A missing key or host means realtime is
//!   disabled. TLS (`wss`) is required; plain `ws` is accepted only in debug
//!   builds, with the caller's dev flag and a loopback host.
//! - [`start`] spawns the connection task on the current tokio runtime and
//!   returns a [`RealtimeHandle`] (state, shutdown) and the receiving end of
//!   the typed [`RealtimeEvent`] channel.
//! - Channel signatures come from a [`ChannelAuthorizer`] supplied by the
//!   shell (`POST /api/v1/broadcasting/auth` with the profile's bearer
//!   token). The crate has no HTTP client and no access to tokens.
//! - The connection is bound to a session generation; the shell closes it
//!   when the generation changes ([`RealtimeHandle::close_if_stale`]).
//! - Logs carry no tokens, channel signatures or event payloads. tungstenite
//!   itself dumps whole frames (signatures included) at `Trace`, so its
//!   targets must stay at `Debug` or below, as the shell log setup does.

#![forbid(unsafe_code)]

mod auth;
mod backoff;
mod client;
mod config;
mod event;
mod protocol;

pub use auth::{AuthRequest, AuthorizeError, ChannelAuth, ChannelAuthorizer};
pub use backoff::Backoff;
pub use client::{Options, RealtimeHandle, start};
pub use config::{
    CLIENT_NAME, ConfigError, PROTOCOL_VERSION, RealtimeConfig, ReverbParams, Transport,
    user_channel,
};
pub use event::{Notification, RealtimeEvent, RealtimeState, StopReason, SubscriptionFailure};
