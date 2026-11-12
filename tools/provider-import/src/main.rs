use serde_json::{json, Value};
use std::env;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::process;

fn home_dir() -> PathBuf {
    env::var("HOME")
        .or_else(|_| env::var("USERPROFILE"))
        .map(PathBuf::from)
        .expect("Cannot determine home directory")
}

fn provider_json_path() -> PathBuf {
    home_dir().join(".clawgod").join("provider.json")
}

fn write_config(path: &Path, config: &Value) {
    let content = serde_json::to_string_pretty(config).unwrap() + "\n";
    fs::write(path, content).unwrap_or_else(|e| {
        eprintln!("  Failed to write {}: {}", path.display(), e);
        process::exit(1);
    });
}

fn detect_grok_key() -> Option<String> {
    if let Ok(key) = env::var("GROK_API_KEY") {
        if !key.is_empty() {
            eprintln!("  Found key in GROK_API_KEY environment variable");
            return Some(key);
        }
    }

    let settings_path = home_dir().join(".grok").join("user-settings.json");
    if let Ok(contents) = fs::read_to_string(&settings_path) {
        if let Ok(parsed) = serde_json::from_str::<Value>(&contents) {
            if let Some(key) = parsed["apiKey"].as_str() {
                if !key.is_empty() {
                    eprintln!("  Found key in {}", settings_path.display());
                    return Some(key.to_string());
                }
            }
        }
    }

    if let Ok(key) = env::var("XAI_API_KEY") {
        if !key.is_empty() {
            eprintln!("  Found key in XAI_API_KEY environment variable");
            return Some(key);
        }
    }

    None
}


fn validate_key(key: &str, base_url: &str) -> Result<Vec<String>, String> {
    let url = format!("{}/models", base_url.trim_end_matches('/'));

    match ureq::get(&url)
        .set("Authorization", &format!("Bearer {}", key))
        .set("Content-Type", "application/json")
        .call()
    {
        Ok(resp) => {
            let body: Value = resp.into_json().unwrap_or(json!({}));
            Ok(body["data"]
                .as_array()
                .map(|arr| {
                    arr.iter()
                        .filter_map(|m| m["id"].as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default())
        }
        Err(ureq::Error::Status(401, _)) => Err("Invalid API key (401 Unauthorized)".into()),
        Err(ureq::Error::Status(code, resp)) => {
            let body = resp.into_string().unwrap_or_default();
            Err(format!("HTTP {} — {}", code, body))
        }
        Err(e) => Err(format!("Connection failed: {}", e)),
    }
}


fn write_provider(provider_type: &str, key: &str, base_url: &str, model: &str, small_model: &str) {
    let config = json!({
        "type": provider_type,
        "apiKey": key,
        "baseURL": base_url,
        "model": model,
        "smallModel": small_model,
        "effort": "",
        "timeoutMs": 3000000
    });

    let path = provider_json_path();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    write_config(&path, &config);
    eprintln!("  Wrote {}", path.display());
}

fn read_current_provider() -> Option<Value> {
    let path = provider_json_path();
    fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
}


fn select_model(models: &[String], default: &str) -> String {
    if models.is_empty() {
        return default.to_string();
    }

    eprintln!("\n  Available models:");
    for (i, m) in models.iter().enumerate() {
        let marker = if m == default { " (default)" } else { "" };
        eprintln!("    [{}] {}{}", i + 1, m, marker);
    }

    let input = prompt(&format!("\n  Select model [default: {}]: ", default));

    if input.is_empty() {
        return default.to_string();
    }

    if let Ok(idx) = input.parse::<usize>() {
        if idx >= 1 && idx <= models.len() {
            return models[idx - 1].clone();
        }
    }

    input
}

fn prompt(label: &str) -> String {
    eprint!("{}", label);
    io::stderr().flush().unwrap();
    let mut input = String::new();
    io::stdin().read_line(&mut input).unwrap();
    input.trim().to_string()
}


fn cmd_import(args: &[String], provider_type: &str) {
    let grok = provider_type == "grok";
    let label = if grok { "Grok / xAI" } else { "OpenAI-Compatible" };
    eprintln!("\n  ── {} Import ──\n", label);

    let mut key = None;
    let mut model_override = None;
    let mut small_model_override = None;
    let mut base_url = if grok { Some("https://api.x.ai/v1".to_string()) } else { None };

    let mut args = args.iter();
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--key" | "-k" => {
                key = args.next().cloned();
            }
            "--model" | "-m" => {
                model_override = args.next().cloned();
            }
            "--small-model" => {
                small_model_override = args.next().cloned();
            }
            "--base-url" => {
                let value = args.next().cloned();
                if value.is_some() || !grok {
                    base_url = value;
                }
            }
            "-u" if !grok => base_url = args.next().cloned(),
            _ => {}
        }
    }

    let api_key = match key {
        Some(k) => {
            if grok { eprintln!("  Using provided key"); }
            k
        }
        None => {
            let detected = if grok {
                eprintln!("  Searching for grok-cli credentials...");
                let key = detect_grok_key();
                if key.is_none() {
                    eprintln!("  No grok-cli key found.");
                }
                key
            } else { None };
            detected.unwrap_or_else(|| {
                let k = prompt("  Enter API key: ");
                if k.is_empty() {
                    eprintln!("  Aborted.");
                    process::exit(1);
                }
                k
            })
        }
    };

    let url = base_url.unwrap_or_else(|| {
        let v = prompt("  Base URL: ");
        if v.is_empty() {
            eprintln!("  Aborted.");
            process::exit(1);
        }
        v
    });

    eprintln!("\n  Verifying key with {}...", url);
    let models = match validate_key(&api_key, &url) {
        Ok(models) => {
            eprintln!("  Key valid.");
            models
        }
        Err(error) if grok => {
            eprintln!("  FAILED: {}", error);
            process::exit(1);
        }
        Err(error) => {
            eprintln!("  WARNING: {}", error);
            eprintln!("  Continuing anyway (some APIs don't expose /models)...\n");
            Vec::new()
        }
    };

    let model = model_override.unwrap_or_else(|| {
        if grok {
            select_model(&models, "grok-4")
        } else if let Some(default) = models.first() {
            select_model(&models, default)
        } else {
            prompt("  Model name: ")
        }
    });

    let small_model = small_model_override.unwrap_or_else(|| {
        if grok {
            models.iter()
                .find(|m| ["grok-3-mini", "grok-3-mini-fast"].contains(&m.as_str()))
                .cloned()
                .unwrap_or_else(|| "grok-3-mini".to_string())
        } else {
            model.clone()
        }
    });

    eprintln!("\n  model: {}", model);
    eprintln!("  smallModel: {}", small_model);
    write_provider(provider_type, &api_key, &url, &model, &small_model);
    eprintln!("\n  Done. Run `claude` to start.\n");
}

fn cmd_status() {
    eprintln!("\n  ── Provider Status ──\n");

    match read_current_provider() {
        Some(config) => {
            let ptype = config["type"].as_str().unwrap_or("anthropic");
            let model = config["model"].as_str().unwrap_or("(default)");
            let small = config["smallModel"].as_str().unwrap_or("(default)");
            let url = config["baseURL"].as_str().unwrap_or("https://api.anthropic.com");
            let has_key = config["apiKey"].as_str().map(|k| !k.is_empty()).unwrap_or(false);

            eprintln!("  type:       {}", ptype);
            eprintln!("  model:      {}", model);
            eprintln!("  smallModel: {}", small);
            eprintln!("  baseURL:    {}", url);
            eprintln!("  apiKey:     {}", if has_key { "(set)" } else { "(empty — using OAuth)" });

            if has_key && (ptype == "grok" || ptype == "openai-compat") {
                let key = config["apiKey"].as_str().unwrap();
                eprintln!("\n  Verifying...");
                match validate_key(key, url) {
                    Ok(models) => eprintln!("  Key valid. {} model(s) available.", models.len()),
                    Err(error) => eprintln!("  Key INVALID: {}", error),
                }
            }
        }
        None => {
            eprintln!("  No provider.json found at {}", provider_json_path().display());
            eprintln!("  Using default (Anthropic OAuth).");
        }
    }
    eprintln!();
}

fn cmd_reset() {
    let default_config = json!({
        "apiKey": "",
        "baseURL": "https://api.anthropic.com",
        "model": "",
        "smallModel": "",
        "effort": "",
        "timeoutMs": 3000000
    });

    let path = provider_json_path();
    write_config(&path, &default_config);
    eprintln!("\n  Reset provider.json to default (Anthropic).\n");
}


fn print_usage() {
    eprintln!(
        r#"
  clawgod-import — Import third-party API providers into clawgod

  Usage:
    clawgod-import grok [options]          Import from grok-cli / xAI
    clawgod-import openai-compat [options] Import any OpenAI-compatible API
    clawgod-import status                  Show current provider config
    clawgod-import reset                   Reset to default (Anthropic)

  Options (grok):
    -k, --key <KEY>           API key (auto-detects from ~/.grok/ if omitted)
    -m, --model <MODEL>       Model name (default: grok-4)
    --small-model <MODEL>     Small/fast model (default: grok-3-mini)
    --base-url <URL>          API base URL (default: https://api.x.ai/v1)

  Options (openai-compat):
    -k, --key <KEY>           API key
    -u, --base-url <URL>      API base URL (required)
    -m, --model <MODEL>       Model name
    --small-model <MODEL>     Small/fast model

  Examples:
    clawgod-import grok                           # auto-detect grok-cli key
    clawgod-import grok -k xai-abc123             # manual key
    clawgod-import openai-compat -k sk-xxx \
      -u https://api.deepseek.com/v1 -m deepseek-chat
"#
    );
}

fn main() {
    let args: Vec<String> = env::args().collect();

    match args.get(1).map(|s| s.as_str()) {
        Some("grok") => cmd_import(&args[2..], "grok"),
        Some("openai-compat") | Some("openai") => cmd_import(&args[2..], "openai-compat"),
        Some("status") => cmd_status(),
        Some("reset") => cmd_reset(),
        Some("--help") | Some("-h") | Some("help") => print_usage(),
        _ => {
            print_usage();
            if args.len() > 1 {
                process::exit(1);
            }
        }
    }
}
