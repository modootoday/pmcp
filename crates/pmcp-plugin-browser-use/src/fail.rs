use chromiumoxide::error::CdpError;

/// Why a tool call failed: the connection to Chromium is gone, or anything else, as text.
/// The type survives up to the call, so a call that fails on a dead socket before the pid
/// watcher sees the exit still reports the browser as gone.
#[derive(Debug, PartialEq)]
pub enum Fail {
    Gone,
    Other(String),
}

/// A lost connection: the socket closed, or a reply's channel was dropped with the handler.
pub fn lost(err: &CdpError) -> bool {
    matches!(
        err,
        CdpError::Ws(_) | CdpError::Io(_) | CdpError::ChannelSendError(_)
    )
}

pub const GONE: &str =
    "Chromium went away (memory limit or crash); the next call starts a fresh browser";

impl std::fmt::Display for Fail {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Fail::Gone => f.write_str(GONE),
            Fail::Other(err) => f.write_str(err),
        }
    }
}

impl From<CdpError> for Fail {
    fn from(err: CdpError) -> Fail {
        match lost(&err) {
            true => Fail::Gone,
            false => Fail::Other(err.to_string()),
        }
    }
}

impl From<String> for Fail {
    fn from(err: String) -> Fail {
        Fail::Other(err)
    }
}

impl From<&str> for Fail {
    fn from(err: &str) -> Fail {
        Fail::Other(err.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // A reply channel dropped with the handler: the "oneshot canceled" a call saw when the
    // socket broke before the pid watcher noticed the exit.
    fn canceled() -> CdpError {
        let (tx, rx) = futures::channel::oneshot::channel::<()>();
        drop(tx);
        let err = futures::executor::block_on(rx).unwrap_err();
        CdpError::from(err)
    }

    #[test]
    fn connection_errors_are_gone_and_the_rest_keep_their_text() {
        assert_eq!(canceled().to_string(), "oneshot canceled");
        assert_eq!(Fail::from(canceled()), Fail::Gone);
        let pipe = std::io::Error::from(std::io::ErrorKind::BrokenPipe);
        assert_eq!(Fail::from(CdpError::from(pipe)), Fail::Gone);
        assert_eq!(
            Fail::from(CdpError::NotFound),
            Fail::Other("Requested value not found.".into())
        );
        assert_eq!(
            Fail::from(CdpError::Timeout),
            Fail::Other("Request timed out.".into())
        );
        assert_eq!(Fail::Gone.to_string(), GONE);
        assert_eq!(Fail::from("no open tab").to_string(), "no open tab");
    }
}
