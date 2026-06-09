param(
  [Parameter(Mandatory=$true)][string]$DocxPath,
  [Parameter(Mandatory=$true)][string]$PdfPath
)

$ErrorActionPreference = "Stop"
$word = $null
$doc = $null
try {
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $word.DisplayAlerts = 0
  $doc = $word.Documents.Open($DocxPath, $false, $false)
  foreach ($field in $doc.Fields) {
    try { [void]$field.Update() } catch {}
  }
  foreach ($toc in $doc.TablesOfContents) {
    try { [void]$toc.Update() } catch {}
  }
  $doc.Save()
  $doc.ExportAsFixedFormat($PdfPath, 17)
}
finally {
  if ($doc -ne $null) { $doc.Close($false) | Out-Null }
  if ($word -ne $null) { $word.Quit() | Out-Null }
}
