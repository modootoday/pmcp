use crate::fail::Fail;
use crate::session::{Session, web_url};
use chromiumoxide::page::Page;
use pmcp_plugin_support::mcp::Out;
use serde_json::Value;
use std::path::Path;
use std::time::{Duration, Instant};

fn e(err: impl std::fmt::Display) -> String {
    err.to_string()
}

/// tabs: list, new (with an optional url), select or close by index.
pub async fn run(s: &mut Session, args: &Value) -> Result<Out, Fail> {
    let action = args["action"].as_str().unwrap_or("list");
    let index = args["index"].as_u64().map(|i| i as usize);
    match action {
        "new" => {
            let url = args["url"].as_str().unwrap_or("about:blank");
            if url != "about:blank" {
                web_url(url)?;
            }
            let page = s.browser.new_page(url).await?;
            s.adopt(page).await?;
            tokio::time::sleep(crate::tools::SETTLE).await;
        }
        "select" | "close" => {
            let i = index.ok_or("index is required")?;
            if i >= s.pages.len() {
                return Err(format!("no tab {i}; there are {}", s.pages.len()).into());
            }
            if action == "close" {
                if s.pages.len() == 1 {
                    return Err("the last tab stays open; use close to end the browser".into());
                }
                let page = s.pages.remove(i);
                page.close().await?;
                s.current = s.current.min(s.pages.len() - 1);
            } else {
                s.current = i;
                s.pages[i].activate().await?;
            }
        }
        "list" => {}
        other => {
            return Err(format!("unknown action {other}; use list, new, select or close").into());
        }
    }
    let mut lines = Vec::new();
    for (i, p) in s.pages.iter().enumerate() {
        let url = p.url().await?.unwrap_or_default();
        let mark = if i == s.current { "*" } else { " " };
        lines.push(format!("{mark}{i} {url}"));
    }
    Ok(Out::Text(lines.join("\n")))
}

/// Waits until the page shows a text or matches a selector, polling every 200 ms.
pub async fn wait_for(page: &Page, args: &Value) -> Result<Out, Fail> {
    let limit = Duration::from_millis(args["timeout_ms"].as_u64().unwrap_or(10_000).min(30_000));
    let check = match (args["text"].as_str(), args["selector"].as_str()) {
        (Some(t), _) => format!(
            "(document.body && document.body.innerText || '').includes({})",
            serde_json::to_string(t).map_err(e)?
        ),
        (None, Some(s)) => format!(
            "!!document.querySelector({})",
            serde_json::to_string(s).map_err(e)?
        ),
        _ => return Err("give text or selector".into()),
    };
    let start = Instant::now();
    loop {
        let found: bool = page
            .evaluate(check.as_str())
            .await?
            .into_value()
            .map_err(e)?;
        if found {
            return Ok(Out::Text(format!(
                "found after {} ms",
                start.elapsed().as_millis()
            )));
        }
        if start.elapsed() > limit {
            return Err(format!("not found within {} ms", limit.as_millis()).into());
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}

pub fn downloads(dir: &Path) -> String {
    let mut lines: Vec<String> = std::fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .filter_map(|f| {
                    Some((
                        f.file_name().to_string_lossy().to_string(),
                        f.metadata().ok()?.len(),
                    ))
                })
                .map(|(n, len)| format!("{n} ({len} bytes)"))
                .collect()
        })
        .unwrap_or_default();
    lines.sort();
    match lines.is_empty() {
        true => format!("no downloads in {}", dir.display()),
        false => format!("{}:\n{}", dir.display(), lines.join("\n")),
    }
}
