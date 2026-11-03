# Text a person would see in the Vyre window, read through UI Automation (the WebView2 page exposes its text there), plus a screenshot.
param([string]$Shot)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms, System.Drawing
$p = Get-Process vyre-desktop -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $p) { "uia: no Vyre window"; } else {
  $root = [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
  $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  $t = (($all | ForEach-Object { $_.Current.Name }) | Where-Object { $_ }) -join ' | '
  "uia: window '$($p.MainWindowTitle)' pid $($p.Id), $($all.Count) elements, text $($t.Length) chars"
  "uia text: " + $t.Substring(0, [Math]::Min(400, $t.Length))
}
$b=[System.Windows.Forms.SystemInformation]::VirtualScreen; $bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height; $g=[System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Left,$b.Top,0,0,$bmp.Size); $bmp.Save($Shot)
