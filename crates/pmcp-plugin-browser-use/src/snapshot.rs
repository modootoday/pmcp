use chromiumoxide::cdp::browser_protocol::accessibility::{AxNode, GetFullAxTreeParams};
use chromiumoxide::cdp::browser_protocol::dom::BackendNodeId;
use chromiumoxide::page::Page;
use std::collections::HashMap;

// The page as its accessibility tree: what a screen reader would announce, with a ref on each
// control, so a model acts on "button Sign in [ref=e4]" instead of guessing pixels.
const LIMIT: usize = 20_000;

const ACTIONABLE: &[&str] = &[
    "button",
    "link",
    "textbox",
    "searchbox",
    "checkbox",
    "radio",
    "combobox",
    "menuitem",
    "menuitemcheckbox",
    "menuitemradio",
    "tab",
    "option",
    "switch",
    "slider",
    "spinbutton",
    "listbox",
    "treeitem",
];

const SILENT: &[&str] = &[
    "none",
    "generic",
    "InlineTextBox",
    "LineBreak",
    "RootWebArea",
];

fn text(v: &Option<chromiumoxide::cdp::browser_protocol::accessibility::AxValue>) -> String {
    v.as_ref()
        .and_then(|v| v.value.as_ref())
        .map(|v| match v {
            serde_json::Value::String(s) => s.clone(),
            other => other.to_string(),
        })
        .unwrap_or_default()
}

pub struct Snapshot {
    pub text: String,
    pub refs: HashMap<String, BackendNodeId>,
}

fn line(node: &AxNode, depth: usize, refs: &mut HashMap<String, BackendNodeId>) -> Option<String> {
    let role = text(&node.role);
    let name = text(&node.name).replace('\n', " ");
    let name = name.trim();
    if SILENT.contains(&role.as_str()) || (name.is_empty() && !ACTIONABLE.contains(&role.as_str()))
    {
        return None;
    }
    let mut out = format!("{}{role}", "  ".repeat(depth.min(20)));
    if !name.is_empty() {
        let short: String = name.chars().take(200).collect();
        out.push_str(&format!(" {short:?}"));
    }
    let value = text(&node.value);
    if !value.is_empty() {
        out.push_str(&format!(
            " value={:?}",
            value.chars().take(200).collect::<String>()
        ));
    }
    if let (true, Some(id)) = (
        ACTIONABLE.contains(&role.as_str()),
        node.backend_dom_node_id,
    ) {
        let r = format!("e{}", refs.len() + 1);
        out.push_str(&format!(" [ref={r}]"));
        refs.insert(r, id);
    }
    Some(out)
}

pub fn render(nodes: &[AxNode]) -> Snapshot {
    let by_id: HashMap<_, _> = nodes.iter().map(|n| (n.node_id.clone(), n)).collect();
    let mut refs = HashMap::new();
    let mut lines = Vec::new();
    let mut stack: Vec<(&AxNode, usize)> = nodes.first().map(|n| vec![(n, 0)]).unwrap_or_default();
    let mut size = 0;
    while let Some((node, depth)) = stack.pop() {
        let shown = match node.ignored {
            true => None,
            false => line(node, depth, &mut refs),
        };
        let child_depth = depth + usize::from(shown.is_some());
        if let Some(l) = shown {
            size += l.len() + 1;
            if size > LIMIT {
                lines.push("… (snapshot cut at 20000 characters; use read_text or scroll)".into());
                break;
            }
            lines.push(l);
        }
        let children = node.child_ids.as_deref().unwrap_or_default();
        for id in children.iter().rev() {
            if let Some(child) = by_id.get(id) {
                stack.push((child, child_depth));
            }
        }
    }
    Snapshot {
        text: lines.join("\n"),
        refs,
    }
}

pub async fn take(page: &Page) -> Result<Snapshot, String> {
    let tree = page
        .execute(GetFullAxTreeParams::default())
        .await
        .map_err(|e| e.to_string())?;
    Ok(render(&tree.result.nodes))
}
