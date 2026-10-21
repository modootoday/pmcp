// Shared by pmcp-pty and the pmcp plugins, so process trees are reaped and capped one way.
pub mod platform;

#[cfg(feature = "reap")]
pub mod reap;

#[cfg(feature = "approved")]
pub mod approved;

#[cfg(feature = "scope")]
pub mod scope;

#[cfg(feature = "scope")]
pub mod doctor;

#[cfg(feature = "mcp")]
pub mod mcp;
