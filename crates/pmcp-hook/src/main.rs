use pmcp_hook::{CompiledPolicy, EvalRequest, evaluate};
use std::fs;
use std::io::{self, Read};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let policy_path = args.get(1).map(String::as_str).unwrap_or("");
    if policy_path.is_empty() {
        eprintln!("usage: pmcp-hook <policy.json>");
        std::process::exit(2);
    }
    let policy_text = match fs::read_to_string(policy_path) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("failed to read policy: {e}");
            std::process::exit(1);
        }
    };
    let policy: CompiledPolicy = match serde_json::from_str(&policy_text) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("failed to parse policy: {e}");
            std::process::exit(1);
        }
    };
    let mut stdin_buf = String::new();
    if let Err(e) = io::stdin().read_to_string(&mut stdin_buf) {
        eprintln!("failed to read stdin: {e}");
        std::process::exit(1);
    }
    let req: EvalRequest = match serde_json::from_str(&stdin_buf) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("failed to parse request: {e}");
            std::process::exit(1);
        }
    };
    let resp = evaluate(&policy, &req);
    println!("{}", serde_json::to_string(&resp).unwrap());
}
