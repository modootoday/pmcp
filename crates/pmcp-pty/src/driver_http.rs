use crate::delivery::{Ctx, Delivered, Delivery};
use crate::http::request;
use crate::session::Session;
use serde_json::json;

// opencode's own server, on the port pmcp-pty pinned at launch: POST prompt_async starts a
// turn. Only in the session the TUI shows: a guessed one (the newest) ran out of view live, so
// with no known session the turn goes to the screen, which opens the TUI's own conversation.
pub struct HttpPromptAsync;

impl Delivery for HttpPromptAsync {
    fn channel(&self) -> &'static str {
        "http-prompt-async"
    }

    fn deliver(&self, _s: &Session, text: &str, ctx: &Ctx) -> Result<Delivered, String> {
        let target = ctx.target.clone().unwrap_or_default();
        let channel = ctx.channel.clone().unwrap_or_default();
        let Some(url) = target.url.or(channel.url) else {
            return Ok(Delivered::Unavailable(
                "no server URL: launch with delivery_setup".into(),
            ));
        };
        let Some(session) = target.session else {
            return Ok(Delivered::Unavailable("no target session".into()));
        };
        let auth = channel.auth.as_ref();
        let path = format!("/session/{session}/prompt_async");
        let body = json!({ "parts": [{ "type": "text", "text": text }] }).to_string();
        match request(&url, "POST", &path, Some(&body), auth) {
            Ok((status, _)) if (200..300).contains(&status) => Ok(Delivered::Sent(json!({
                "ok": true, "accepted": true, "submitted": true, "url": url, "session": session, "status": status,
            }))),
            Ok((status, body)) => Ok(Delivered::Unavailable(format!(
                "{path} answered {status}: {}",
                body.chars().take(200).collect::<String>()
            ))),
            Err(e) => Ok(Delivered::Unavailable(e)),
        }
    }
}
