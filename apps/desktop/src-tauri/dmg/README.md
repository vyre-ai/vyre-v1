# The Mac install window

`background.svg` is the source. Finder needs both pixel densities in one file, so `background.tiff` holds 1x and 2x.

Rebuild it on any Mac after rendering the SVG to 660x440 and 1320x880 PNGs:

    tiffutil -cathidpicheck background.png background@2x.png -out background.tiff

The picture is taller than the 400 pt content area on purpose. Finder pins it to the top left, so the extra ground covers a title bar of any height. Icon centres here match `bundle.macOS.dmg` in `tauri.conf.json`, and `ci/dmg-window.sh` checks them in the built DMG.
