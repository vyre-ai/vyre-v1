// The binary entry. Release builds on Windows hide the console window.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    vyre_desktop::run();
}
