# The Mac install window

`background.svg` is the source. Finder needs both pixel densities in one file, so `background.tiff` holds 1x and 2x.

Rebuild it on any Mac after rendering the SVG to 900x640 and 1800x1280 PNGs:

    sips -s format tiff -s dpiWidth 72 -s dpiHeight 72 background.png --out 1.tiff
    sips -s format tiff -s dpiWidth 144 -s dpiHeight 144 background@2x.png --out 2.tiff
    tiffutil -cat 1.tiff 2.tiff -out background.tiff

The 2x layer must say 144 dpi, or Finder reads it as a picture twice the size.

The picture is larger than the 660 by 396 pt window on purpose. Finder pins it to the top left, so a window that is enlarged, or scrolls because hidden files are showing, still has ground under it. Icon centres here match `bundle.macOS.dmg` in `tauri.conf.json`, and `ci/dmg-window.sh` checks them in the built DMG.
