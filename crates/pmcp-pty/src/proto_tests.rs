use super::*;

#[test]
fn write_request_defaults_to_idle_guard() {
    let r: Request = serde_json::from_str(r#"{"op":"write","id":"s1","text":"hi"}"#).unwrap();
    let Request::Write(w) = r else {
        panic!("not a write")
    };
    assert_eq!(w.guard, Guard::Idle);
    assert!(!w.submit);
    assert_eq!(w.expect, None);
}

#[test]
fn list_takes_optional_labels_and_wait_mixes_names_and_text() {
    let r: Request = serde_json::from_str(r#"{"op":"list"}"#).unwrap();
    assert!(matches!(r, Request::List { labels } if labels.is_empty()));
    let w = r#"{"op":"wait","id":"s1","until":["idle",{"text":"done$"}],"timeout_ms":5}"#;
    let Request::Wait(w) = serde_json::from_str(w).unwrap() else {
        panic!("not a wait")
    };
    let want = vec![
        Until::Named("idle".into()),
        Until::Text {
            text: "done$".into(),
        },
    ];
    assert_eq!(w.until, want);
}

#[test]
fn record_redacts_unless_told_not_to() {
    let r: Request = serde_json::from_str(r#"{"op":"record","id":"s1","label":"x"}"#).unwrap();
    assert!(matches!(r, Request::Record { redact: true, .. }));
    let raw = r#"{"op":"record","id":"s1","label":"x","redact":false}"#;
    let r: Request = serde_json::from_str(raw).unwrap();
    assert!(matches!(r, Request::Record { redact: false, .. }));
}

#[test]
fn requests_round_trip_for_library_callers() {
    let turn = Request::Turn(TurnReq {
        id: "s2".into(),
        text: "hi".into(),
        timeout_ms: Some(10),
        expect: Some(Expect {
            instance: Some("1-2".into()),
            pid: Some(7),
            lease: None,
        }),
        target: None,
        wait_idle_ms: None,
    });
    let line = serde_json::to_string(&turn).unwrap();
    assert!(line.starts_with(r#"{"op":"turn","id":"s2""#), "{line}");
    let back: Request = serde_json::from_str(&line).unwrap();
    let Request::Turn(t) = back else {
        panic!("not a turn")
    };
    assert_eq!(t.expect.and_then(|e| e.pid), Some(7));
}
