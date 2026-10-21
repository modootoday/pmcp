use crate::error::{Code, Fail};
use crate::profile::ScreenMatch;

pub struct Observation<'a> {
    pub alive: bool,
    pub idle_ms: u64,
    pub idle_threshold_ms: u64,
    pub screen: &'a ScreenMatch,
    // The profile reads an input box and none is on screen yet (Profile::composer_missing).
    pub composer_missing: bool,
}

// How soon a TUI still drawing its first screen is worth asking again.
const NOT_READY_RETRY_MS: u64 = 500;

pub fn check_idle(obs: &Observation) -> Result<(), Fail> {
    if !obs.alive {
        return Err(Fail::new(Code::Exited, "session has exited"));
    }
    if let Some(dialog) = &obs.screen.dialog {
        return Err(Fail::new(
            Code::DialogOpen,
            format!("dialog detected: {dialog}"),
        ));
    }
    if let Some(busy) = &obs.screen.busy {
        return Err(Fail::new(Code::Busy, format!("runtime busy: {busy}")));
    }
    if obs.idle_ms < obs.idle_threshold_ms {
        let message = format!(
            "output not idle: {}ms < {}ms",
            obs.idle_ms, obs.idle_threshold_ms
        );
        let mut fail = Fail::new(Code::Busy, message);
        fail.retry_after_ms = Some(obs.idle_threshold_ms - obs.idle_ms);
        return Err(fail);
    }
    if obs.composer_missing {
        let mut fail = Fail::new(Code::Busy, "no input box on screen yet");
        fail.retry_after_ms = Some(NOT_READY_RETRY_MS);
        return Err(fail);
    }
    if obs.screen.input_empty == Some(false) {
        return Err(Fail::new(Code::Guard, "input box is not empty"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn obs(screen: &ScreenMatch, idle_ms: u64) -> Observation<'_> {
        Observation {
            alive: true,
            idle_ms,
            idle_threshold_ms: 1000,
            screen,
            composer_missing: false,
        }
    }

    fn refusal(o: &Observation) -> (Code, String) {
        let fail = check_idle(o).unwrap_err();
        (fail.code, fail.message)
    }

    #[test]
    fn accepts_idle_screen_without_dialog() {
        let m = ScreenMatch {
            input_empty: Some(true),
            ..Default::default()
        };
        assert_eq!(check_idle(&obs(&m, 1500)), Ok(()));
    }

    #[test]
    fn refuses_when_dialog_shown_even_if_idle() {
        let m = ScreenMatch {
            dialog: Some("tool-confirm-exec".into()),
            ..Default::default()
        };
        let want = (
            Code::DialogOpen,
            "dialog detected: tool-confirm-exec".into(),
        );
        assert_eq!(refusal(&obs(&m, 60_000)), want);
    }

    #[test]
    fn refuses_while_output_is_recent_and_says_when_to_retry() {
        let m = ScreenMatch::default();
        let fail = check_idle(&obs(&m, 200)).unwrap_err();
        assert_eq!(fail.code, Code::Busy);
        assert_eq!(fail.message, "output not idle: 200ms < 1000ms");
        assert_eq!(fail.retry_after_ms, Some(800));
    }

    #[test]
    fn refuses_busy_runtime() {
        let m = ScreenMatch {
            busy: Some("responding".into()),
            ..Default::default()
        };
        let (code, message) = refusal(&obs(&m, 5000));
        assert_eq!(code, Code::Busy);
        assert!(message.starts_with("runtime busy"));
    }

    #[test]
    fn refuses_non_empty_input_box_but_not_unknown_one() {
        let typed = ScreenMatch {
            input_empty: Some(false),
            ..Default::default()
        };
        let want = (Code::Guard, "input box is not empty".into());
        assert_eq!(refusal(&obs(&typed, 5000)), want);
        let unknown = ScreenMatch::default();
        assert_eq!(check_idle(&obs(&unknown, 5000)), Ok(()));
        // No box drawn yet is busy with a retry, not a draft that would never clear.
        let mut starting = obs(&unknown, 5000);
        starting.composer_missing = true;
        let fail = check_idle(&starting).unwrap_err();
        assert_eq!((fail.code, fail.retry_after_ms), (Code::Busy, Some(500)));
    }

    #[test]
    fn refuses_exited_session_first() {
        let m = ScreenMatch {
            dialog: Some("x".into()),
            ..Default::default()
        };
        let o = Observation {
            alive: false,
            idle_ms: 0,
            idle_threshold_ms: 1000,
            screen: &m,
            composer_missing: false,
        };
        assert_eq!(refusal(&o), (Code::Exited, "session has exited".into()));
    }
}
