use tauri::{
  menu::{Menu, MenuItem},
  tray::{TrayIconBuilder, TrayIconEvent},
  Emitter, Manager,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    // 单实例必须最先注册：用户点 zenew:// 深链时，第二次启动会把 URL 转发给已运行的实例
    .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
      for arg in argv.iter().filter(|a| a.starts_with("zenew://")) {
        let _ = app.emit("deep-link", arg.clone());
      }
      if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
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
      // 托盘：任务栏隐藏图标区常驻（图标=应用图标）
      // 左键单击 = 显示/聚焦主窗口；右键菜单 = 打开知新 / 退出
      let open = MenuItem::with_id(app, "open", "打开知新", true, None::<&str>)?;
      let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
      let menu = Menu::with_items(app, &[&open, &quit])?;
      let _tray = TrayIconBuilder::with_id("main-tray")
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("知新 Zenew")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
          "open" => {
            if let Some(w) = app.get_webview_window("main") {
              let _ = w.show();
              let _ = w.unminimize();
              let _ = w.set_focus();
            }
          }
          "quit" => {
            app.exit(0);
          }
          _ => {}
        })
        .on_tray_icon_event(|tray, event| {
          if let TrayIconEvent::Click { button, button_state, .. } = event {
            // 左键抬起 = 显示窗口（右键走菜单）
            if button == tauri::tray::MouseButton::Left && button_state == tauri::tray::MouseButtonState::Up {
              let app = tray.app_handle();
              if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.set_focus();
              }
            }
          }
        })
        .build(app)?;
      // 主窗口关闭 = 隐藏到托盘（学习进度不丢，后台继续常驻）；真正退出走托盘菜单
      let main = app.get_webview_window("main").expect("main window");
      let window_clone = main.clone();
      main.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
          api.prevent_close();
          let _ = window_clone.hide();
        }
      });
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
