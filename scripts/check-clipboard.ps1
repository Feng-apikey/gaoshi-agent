Add-Type -AssemblyName PresentationCore
$cb = [System.Windows.Clipboard]::GetText()
if ([string]::IsNullOrEmpty($cb)) {
  Write-Output "CLEAN (empty)"
} else {
  Write-Output "DIRTY: $cb"
}