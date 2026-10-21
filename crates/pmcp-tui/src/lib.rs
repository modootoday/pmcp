// pmcp-tui as a library: the state machine, layout and widgets, kept free of the real terminal so
// tests drive them with events and render into a test buffer.
mod actions;
mod control;
#[cfg(test)]
mod control_tests;
pub mod draw;
pub mod events;
pub mod exec;
pub mod host;
pub mod input;
pub mod keys;
pub mod layout;
mod panels;
pub mod screen;
pub mod state;
#[cfg(test)]
mod state_tests;
pub mod summary;
