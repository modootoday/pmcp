// pmcp-desktop: an Xvfb desktop a coding agent sees through screenshots and drives through XTEST,
// over MCP on stdio. The library is what the binary and the tests share.
#![cfg(unix)]
pub mod catalog;
pub mod checks;
pub mod display;
pub mod image;
pub mod keys;
pub mod launch;
pub mod lazy;
pub mod tools;
pub mod x;
