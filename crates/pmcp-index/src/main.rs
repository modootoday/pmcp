use pmcp_index::{IndexManifest, scan_incremental};
use std::fs;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        eprintln!("usage: pmcp-index <manifest.json> [file...]");
        std::process::exit(2);
    }
    let manifest_path = &args[1];
    let previous: IndexManifest = fs::read_to_string(manifest_path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    let files = &args[2..];
    let (next, stats) = scan_incremental(files, &previous);
    if let Err(e) = fs::write(manifest_path, serde_json::to_string_pretty(&next).unwrap()) {
        eprintln!("failed to write manifest: {e}");
        std::process::exit(1);
    }
    println!("{}", serde_json::to_string(&stats).unwrap());
}
