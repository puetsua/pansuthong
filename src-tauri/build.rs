fn main() {
    let manifest_dir = std::path::PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));

    // MSVC: link the Common-Controls v6 manifest into every binary, including
    // `cargo test` executables. The tray menu (#252) needs comctl32 v6, and a
    // test exe without the manifest dies at load with STATUS_ENTRYPOINT_NOT_FOUND.
    // tauri-build's default only embeds it into the app binary. The GNU release
    // target keeps the default resource-embedded manifest.
    let msvc = std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc");
    if msvc {
        let manifest = manifest_dir.join("windows").join("app-manifest.xml");
        println!("cargo:rerun-if-changed={}", manifest.display());
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
        let windows = tauri_build::WindowsAttributes::new_without_app_manifest();
        tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows))
            .expect("tauri-build");
    } else {
        tauri_build::build()
    }
}
