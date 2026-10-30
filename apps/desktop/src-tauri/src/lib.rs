//! Ostra desktop: a thin native shell around the same Vite build as the web
//! app. Native pieces are the SQLite cache (tauri-plugin-sql) and opening
//! OAuth consent screens in the system browser (tauri-plugin-opener), since
//! Google and Microsoft refuse sign-in inside embedded webviews.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .run(tauri::generate_context!())
        .expect("error while running Ostra");
}
