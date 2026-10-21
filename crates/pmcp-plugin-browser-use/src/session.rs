use chromiumoxide::browser::{Browser, BrowserConfig};
use chromiumoxide::cdp::browser_protocol::browser::{
    SetDownloadBehaviorBehavior, SetDownloadBehaviorParams,
};
use chromiumoxide::cdp::browser_protocol::network::{
    BlockPattern, EnableParams, SetBlockedUrLsParams,
};
use chromiumoxide::error::CdpError;
use chromiumoxide::page::Page;
use futures::StreamExt;
use std::path::{Path, PathBuf};
use tokio::task::JoinHandle;

// Schemes that never reach the proxy, blocked in each page instead (URLPattern entries); navigate
// accepts only http and https as well. data: is left out: Chromium already refuses top-level
// data: navigations from a page, and blocking it would break inline images.
pub const BLOCKED: &[&str] = &[
    "file://*",
    "chrome://*",
    "chrome-extension://*",
    "devtools://*",
    "view-source:*",
    "javascript:*",
    "blob:*",
    "ftp://*",
];

#[derive(Clone)]
pub struct Launch {
    // None: the pinned build, found and checked at the first launch.
    pub chromium: Option<PathBuf>,
    pub profile: PathBuf,
    pub downloads: PathBuf,
    pub proxy_port: u16,
    // Headed on an existing display (pmcp-desktop's), with its DISPLAY and XAUTHORITY.
    pub display: Option<[(String, String); 2]>,
}

pub struct Session {
    pub browser: Browser,
    pub pid: u32,
    handler: JoinHandle<()>,
    profile: PathBuf,
    downloads: PathBuf,
    pub pages: Vec<Page>,
    pub current: usize,
    downloads_off: bool,
}

pub const DOWNLOAD_CAP: u64 = 512 << 20;

fn args(l: &Launch) -> Vec<(String, String)> {
    let mut out = vec![
        (
            "proxy-server".into(),
            format!("http://127.0.0.1:{}", l.proxy_port),
        ),
        // Loopback goes through the proxy too, where it is refused unless approved.
        ("proxy-bypass-list".into(), "<-loopback>".into()),
        (
            "force-webrtc-ip-handling-policy".into(),
            "disable_non_proxied_udp".into(),
        ),
        (
            "disable-features".into(),
            "DnsOverHttps,MediaRouter,OptimizationHints".into(),
        ),
    ];
    out.push(("window-size".into(), "1280,800".into()));
    out
}

impl Session {
    /// A Chromium on a fresh profile, sandbox on, certificate errors respected.
    pub async fn launch(l: &Launch) -> Result<Session, String> {
        std::fs::create_dir_all(&l.downloads).map_err(|e| e.to_string())?;
        let exe = match &l.chromium {
            Some(path) => path.clone(),
            None => crate::checks::chromium_once()?,
        };
        let mut config = BrowserConfig::builder()
            .chrome_executable(&exe)
            .user_data_dir(&l.profile)
            .respect_https_errors()
            .viewport(None)
            .arg("dns-prefetch-disable")
            .arg("no-default-browser-check");
        for (k, v) in args(l) {
            config = config.arg((k.as_str(), v.as_str()));
        }
        config = match &l.display {
            Some(env) => config.with_head().envs(env.clone()),
            None => config.new_headless_mode(),
        };
        let (browser, mut handler) = Browser::launch(config.build()?)
            .await
            .map_err(|e| format!("chromium: {e}"))?;
        // A lost connection shows up as errors, not as the end of the stream: live, a killed
        // Chromium left calls waiting on a dead socket. Only connection errors end the handler;
        // events newer than chromiumoxide's protocol types fail to decode on a healthy one.
        let handler = tokio::spawn(async move {
            while let Some(item) = handler.next().await {
                if let Err(CdpError::Ws(_) | CdpError::Io(_) | CdpError::ChannelSendError(_)) = item
                {
                    break;
                }
            }
        });
        let mut browser = browser;
        let pid = browser
            .get_mut_child()
            .and_then(|c| c.inner.id())
            .unwrap_or(0);
        let mut s = Session {
            browser,
            pid,
            handler,
            profile: l.profile.clone(),
            downloads: l.downloads.clone(),
            pages: Vec::new(),
            current: 0,
            downloads_off: false,
        };
        let download = SetDownloadBehaviorParams::builder()
            .behavior(SetDownloadBehaviorBehavior::Allow)
            .download_path(l.downloads.display().to_string())
            .build()?;
        s.browser
            .execute(download)
            .await
            .map_err(|e| e.to_string())?;
        let page = s
            .browser
            .new_page("about:blank")
            .await
            .map_err(|e| e.to_string())?;
        s.adopt(page).await?;
        Ok(s)
    }

    /// Every page this session hands out first gets the scheme block list.
    pub async fn adopt(&mut self, page: Page) -> Result<(), String> {
        page.execute(EnableParams::default())
            .await
            .map_err(|e| e.to_string())?;
        let patterns: Vec<BlockPattern> = BLOCKED
            .iter()
            .map(|p| BlockPattern::new(*p, true))
            .collect();
        let block = SetBlockedUrLsParams::builder()
            .url_patterns(patterns)
            .build();
        page.execute(block).await.map_err(|e| e.to_string())?;
        self.pages.push(page);
        self.current = self.pages.len() - 1;
        Ok(())
    }

    pub fn page(&self) -> Result<&Page, String> {
        self.pages
            .get(self.current)
            .ok_or_else(|| "no open tab".to_string())
    }

    pub fn downloads(&self) -> &Path {
        &self.downloads
    }

    // Alive while the CDP connection runs and the process has not exited; try_wait also reaps
    // a Chromium that the scope or a signal killed.
    pub fn alive(&mut self) -> bool {
        let exited = self
            .browser
            .get_mut_child()
            .is_none_or(|c| !matches!(c.try_wait(), Ok(None)));
        !self.handler.is_finished() && !exited
    }

    /// Past the cap, further downloads are refused for this session; said once, in the reply.
    pub async fn cap_downloads(&mut self) -> String {
        if self.downloads_off || crate::limits::used(&self.downloads) <= DOWNLOAD_CAP {
            return String::new();
        }
        let deny = SetDownloadBehaviorParams::builder()
            .behavior(SetDownloadBehaviorBehavior::Deny)
            .build();
        if let Ok(deny) = deny {
            let _ = self.browser.execute(deny).await;
        }
        self.downloads_off = true;
        format!(
            "\ndownloads passed {} MiB; further downloads are refused in this browser",
            DOWNLOAD_CAP >> 20
        )
    }

    /// Closes Chromium, waits for its tree and deletes the profile: nothing of a session stays.
    /// A dead session skips the polite close, which would only wait on a dead connection.
    pub async fn close(mut self) {
        let wait = std::time::Duration::from_secs(3);
        if self.alive() {
            let _ = tokio::time::timeout(wait, self.browser.close()).await;
            let _ = tokio::time::timeout(wait, self.browser.wait()).await;
        }
        let _ = tokio::time::timeout(wait, self.browser.kill()).await;
        self.handler.abort();
        let profile = self.profile.clone();
        let _ = tokio::task::spawn_blocking(move || {
            crate::procs::sweep(&profile);
            // A file written while the tree is removed fails the removal; try again briefly.
            for _ in 0..20 {
                if std::fs::remove_dir_all(&profile).is_ok() || !profile.exists() {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
        })
        .await;
    }
}

/// navigate's own check, before Chromium sees the URL.
pub fn web_url(url: &str) -> Result<(), String> {
    let lower = url.trim().to_ascii_lowercase();
    match lower.starts_with("http://") || lower.starts_with("https://") {
        true => Ok(()),
        false => Err(format!("only http and https URLs open here, not {url}")),
    }
}
