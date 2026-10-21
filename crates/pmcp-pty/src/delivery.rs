use crate::channel::Channel;
use crate::driver_acp::GrokLeaderAcp;
use crate::driver_claude::ClaudeInbox;
use crate::driver_codex::CodexQueue;
use crate::driver_http::HttpPromptAsync;
use crate::proto::{Guard, Target};
use crate::session::Session;
use crate::signals::Shared;
use crate::write::{Input, write};
use serde_json::{Value, json};

// How a turn's text reaches the runtime. Every channel ends in the same turn outcome; the reply
// comes from the channel when it reports one, else from the clean transcript.
pub enum Delivered {
    Sent(Value),
    Refused(Value),
    Unavailable(String),
}

/// What a driver may use: the channel set up at launch, the caller's target, HOME, and the
/// session's signals, where a channel that sees its turn end says so.
#[derive(Default)]
pub struct Ctx {
    pub channel: Option<Channel>,
    pub target: Option<Target>,
    pub home: Option<String>,
    pub signals: Shared,
}

pub trait Delivery {
    fn channel(&self) -> &'static str;
    fn deliver(&self, s: &Session, text: &str, ctx: &Ctx) -> Result<Delivered, String>;
}

pub struct Screen;

impl Delivery for Screen {
    fn channel(&self) -> &'static str {
        "screen"
    }

    fn deliver(&self, s: &Session, text: &str, _ctx: &Ctx) -> Result<Delivered, String> {
        let input = Input {
            text,
            submit: true,
            guard: Guard::Idle,
            wait_ms: 200,
        };
        let receipt = write(s, input)?;
        let sent = receipt["accepted"] == true && receipt["submitted"] == true;
        Ok(match sent {
            true => Delivered::Sent(receipt),
            false => Delivered::Refused(receipt),
        })
    }
}

// The profile's preferred channel comes first; screen with guard idle is always the last resort.
fn drivers(s: &Session) -> Vec<Box<dyn Delivery>> {
    let first: Option<Box<dyn Delivery>> = match s.profile.delivery.as_deref() {
        Some("claude-inbox") => Some(Box::new(ClaudeInbox)),
        Some("http-prompt-async") => Some(Box::new(HttpPromptAsync)),
        Some("codex-queue") => Some(Box::new(CodexQueue)),
        Some("grok-leader-acp") => Some(Box::new(GrokLeaderAcp)),
        _ => None,
    };
    first
        .into_iter()
        .chain([Box::new(Screen) as Box<dyn Delivery>])
        .collect()
}

fn annotate(mut receipt: Value, channel: &str, fallbacks: &[String]) -> Value {
    receipt["channel"] = json!(channel);
    receipt["fallback"] = json!(fallbacks.join("; "));
    receipt
}

// A structured channel is used only while the screen shows no dialog, the same rule the
// screen guard applies, so a turn never lands behind a pending approval.
pub fn deliver(s: &Session, text: &str, ctx: &Ctx) -> Result<Delivered, String> {
    let mut fallbacks: Vec<String> = Vec::new();
    let dialog = s.observe().0.dialog;
    for driver in drivers(s) {
        let channel = driver.channel();
        if channel != "screen"
            && let Some(d) = &dialog
        {
            fallbacks.push(format!("{channel}: dialog on screen ({d})"));
            continue;
        }
        match driver.deliver(s, text, ctx)? {
            Delivered::Sent(r) => return Ok(Delivered::Sent(annotate(r, channel, &fallbacks))),
            Delivered::Refused(r) => {
                return Ok(Delivered::Refused(annotate(r, channel, &fallbacks)));
            }
            Delivered::Unavailable(why) => fallbacks.push(format!("{channel}: {why}")),
        }
    }
    Ok(Delivered::Unavailable(fallbacks.join("; ")))
}
