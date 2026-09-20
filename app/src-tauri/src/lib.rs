use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    // 单实例必须最先注册：用户点 zenew:// 深链时，第二次启动会把 URL 转发给已运行的实例
    .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
      for arg in argv.iter().filter(|a| a.starts_with("zenew://")) {
        let _ = app.emit("deep-link", arg.clone());
      }
      if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_focus();
        let _ = w.unminimize();
      }
    }))
    .plugin(tauri_plugin_deep_link::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_sql::Builder::default().build())
    .setup(|app| {
      // 冷启动时 URL 在自身参数里（应用原本没开着）：窗口起来后补发事件
      let startup_url = std::env::args().find(|a| a.starts_with("zenew://"));
      if let Some(url) = startup_url {
        let handle = app.handle().clone();
        std::thread::spawn(move || {
          std::thread::sleep(std::time::Duration::from_millis(1500));
          let _ = handle.emit("deep-link", url);
        });
      }
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
