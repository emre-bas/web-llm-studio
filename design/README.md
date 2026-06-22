# Design sources

Master icon artwork. These files are **not** deployed — they live outside
`public/` on purpose so the ~2 MB of full-res source art is never shipped to
GitHub Pages. They are the sources from which the runtime icons are generated.

| Source                 | Used to generate                                                              | Note                                            |
| ---------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------- |
| `icon.png`             | `public/apple-touch-icon.png`, `public/icon-192.png`, `public/icon-512.png`   | Dark rounded-square app-icon (filled bg)        |
| `icon-transparent.png` | `public/favicon.png`, `src/assets/logo.png`                                   | Bare mark, transparent bg — for UI & browser tab |

Installed-app / PWA / maskable icons keep the filled background (iOS renders a
transparent apple-touch-icon as black). The in-app sidebar logo and favicon use
the transparent mark so it blends with the surrounding background.

## Regenerate (Windows PowerShell, no extra tooling)

```powershell
Add-Type -AssemblyName System.Drawing
function Resize($src, $out, $size) {
  $img = [System.Drawing.Image]::FromFile($src)
  $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = 'HighQualityBicubic'; $g.PixelOffsetMode = 'HighQuality'
  $g.SmoothingMode = 'HighQuality'; $g.CompositingQuality = 'HighQuality'
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.DrawImage($img, 0, 0, $size, $size)
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose(); $img.Dispose()
}
Resize design\icon.png             public\apple-touch-icon.png 180
Resize design\icon.png             public\icon-192.png         192
Resize design\icon.png             public\icon-512.png         512
Resize design\icon-transparent.png public\favicon.png          64
Resize design\icon-transparent.png src\assets\logo.png         128
```
