use chromiumoxide::cdp::browser_protocol::dom::{
    BackendNodeId, FocusParams, GetBoxModelParams, ScrollIntoViewIfNeededParams,
};
use chromiumoxide::cdp::browser_protocol::input::{
    DispatchKeyEventParams, DispatchKeyEventType, DispatchMouseEventParams, DispatchMouseEventType,
    InsertTextParams, MouseButton,
};
use chromiumoxide::page::Page;

use crate::fail::Fail;
use serde_json::Value;
use std::collections::HashMap;

// Input goes through CDP's Input domain, as real mouse and key events, so pages see what a person
// would do; a ref from the last snapshot, a CSS selector or page coordinates says where.
pub enum Target {
    Node(BackendNodeId),
    Selector(String),
    Point(f64, f64),
}

pub fn target(args: &Value, refs: &HashMap<String, BackendNodeId>) -> Result<Target, Fail> {
    if let Some(r) = args["ref"].as_str() {
        let id = refs
            .get(r)
            .ok_or_else(|| format!("no ref {r} in the last snapshot; take a snapshot"))?;
        return Ok(Target::Node(*id));
    }
    if let Some(s) = args["selector"].as_str() {
        return Ok(Target::Selector(s.to_string()));
    }
    match (args["x"].as_f64(), args["y"].as_f64()) {
        (Some(x), Some(y)) => Ok(Target::Point(x, y)),
        _ => Err("give ref, selector, or x and y".into()),
    }
}

async fn center(page: &Page, id: BackendNodeId) -> Result<(f64, f64), Fail> {
    let scroll = ScrollIntoViewIfNeededParams::builder()
        .backend_node_id(id)
        .build();
    page.execute(scroll).await?;
    let model = page
        .execute(GetBoxModelParams::builder().backend_node_id(id).build())
        .await?;
    let quad = model.result.model.content.inner();
    if quad.len() < 8 {
        return Err("the element has no box on the page".into());
    }
    let x = (quad[0] + quad[2] + quad[4] + quad[6]) / 4.0;
    let y = (quad[1] + quad[3] + quad[5] + quad[7]) / 4.0;
    Ok((x, y))
}

async fn point(page: &Page, t: &Target) -> Result<(f64, f64), Fail> {
    match t {
        Target::Node(id) => center(page, *id).await,
        Target::Point(x, y) => Ok((*x, *y)),
        Target::Selector(s) => {
            let el = page
                .find_element(s.as_str())
                .await
                .map_err(|err| match Fail::from(err) {
                    Fail::Other(err) => Fail::Other(format!("{s}: {err}")),
                    gone => gone,
                })?;
            el.scroll_into_view().await?;
            let p = el.clickable_point().await?;
            Ok((p.x, p.y))
        }
    }
}

async fn mouse(
    page: &Page,
    kind: DispatchMouseEventType,
    x: f64,
    y: f64,
    count: i64,
) -> Result<(), Fail> {
    let p = DispatchMouseEventParams::builder()
        .r#type(kind)
        .x(x)
        .y(y)
        .button(MouseButton::Left)
        .click_count(count)
        .build()?;
    page.execute(p).await?;
    Ok(())
}

pub async fn click(page: &Page, t: &Target, count: i64) -> Result<(f64, f64), Fail> {
    let (x, y) = point(page, t).await?;
    mouse(page, DispatchMouseEventType::MouseMoved, x, y, 0).await?;
    for n in 1..=count {
        mouse(page, DispatchMouseEventType::MousePressed, x, y, n).await?;
        mouse(page, DispatchMouseEventType::MouseReleased, x, y, n).await?;
    }
    Ok((x, y))
}

pub async fn type_into(page: &Page, t: &Target, text: &str) -> Result<(), Fail> {
    match t {
        Target::Node(id) => {
            page.execute(FocusParams::builder().backend_node_id(*id).build())
                .await?;
        }
        other => {
            click(page, other, 1).await?;
        }
    }
    page.execute(InsertTextParams::new(text)).await?;
    Ok(())
}

// (key, code, keyCode, text) for the keys models press most.
const KEYS: &[(&str, &str, i64, &str)] = &[
    ("Enter", "Enter", 13, "\r"),
    ("Tab", "Tab", 9, ""),
    ("Escape", "Escape", 27, ""),
    ("Backspace", "Backspace", 8, ""),
    ("Delete", "Delete", 46, ""),
    ("ArrowUp", "ArrowUp", 38, ""),
    ("ArrowDown", "ArrowDown", 40, ""),
    ("ArrowLeft", "ArrowLeft", 37, ""),
    ("ArrowRight", "ArrowRight", 39, ""),
    ("Home", "Home", 36, ""),
    ("End", "End", 35, ""),
    ("PageUp", "PageUp", 33, ""),
    ("PageDown", "PageDown", 34, ""),
    ("Space", "Space", 32, " "),
];

/// A key or chord such as Enter, ctrl+a or shift+Tab.
pub async fn press(page: &Page, chord: &str) -> Result<(), Fail> {
    let parts: Vec<&str> = chord.split('+').map(str::trim).collect();
    let (key, mods) = parts.split_last().ok_or("empty key")?;
    let mut modifiers = 0;
    for m in mods {
        modifiers |= match m.to_ascii_lowercase().as_str() {
            "alt" => 1,
            "ctrl" | "control" => 2,
            "meta" | "cmd" => 4,
            "shift" => 8,
            other => return Err(format!("unknown modifier {other}").into()),
        };
    }
    let found = KEYS.iter().find(|k| k.0.eq_ignore_ascii_case(key));
    let (k, code, num, text) = match found {
        Some(&(k, c, n, t)) => (k.to_string(), c.to_string(), n, t.to_string()),
        None if key.chars().count() == 1 => {
            let c = key.chars().next().unwrap_or(' ');
            let upper = c.to_ascii_uppercase();
            (
                key.to_string(),
                format!("Key{upper}"),
                upper as i64,
                if modifiers & 7 == 0 {
                    key.to_string()
                } else {
                    String::new()
                },
            )
        }
        None => return Err(format!("unknown key {key}").into()),
    };
    for kind in [DispatchKeyEventType::KeyDown, DispatchKeyEventType::KeyUp] {
        let mut b = DispatchKeyEventParams::builder()
            .r#type(kind.clone())
            .key(k.clone())
            .code(code.clone())
            .windows_virtual_key_code(num)
            .modifiers(modifiers);
        if matches!(kind, DispatchKeyEventType::KeyDown) && !text.is_empty() {
            b = b.text(text.clone());
        }
        page.execute(b.build()?).await?;
    }
    Ok(())
}
