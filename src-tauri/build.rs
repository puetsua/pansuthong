fn main() {
    let manifest_dir = std::path::PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let config_path = manifest_dir.join("tauri.conf.json");
    let config_text = std::fs::read_to_string(&config_path)
        .unwrap_or_else(|e| panic!("read {}: {e}", config_path.display()));
    let config: serde_json::Value = serde_json::from_str(&config_text)
        .unwrap_or_else(|e| panic!("parse {}: {e}", config_path.display()));
    let identifier = config["identifier"]
        .as_str()
        .unwrap_or_else(|| panic!("identifier missing in {}", config_path.display()));
    println!("cargo:rustc-env=TAURI_APP_IDENTIFIER={identifier}");
    tauri_build::build()
}
