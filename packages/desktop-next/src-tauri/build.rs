fn main() {
    println!("cargo:rerun-if-env-changed=PASEO_NEXT_DEFAULT_DAEMON_MODE");
    #[cfg(target_os = "macos")]
    {
        println!("cargo:rerun-if-changed=src/macos_notifications.m");
        cc::Build::new()
            .file("src/macos_notifications.m")
            .flag("-fobjc-arc")
            .compile("paseo_macos_notifications");
        println!("cargo:rustc-link-lib=framework=UserNotifications");
        println!("cargo:rustc-link-lib=framework=Foundation");
    }
    tauri_build::build()
}
