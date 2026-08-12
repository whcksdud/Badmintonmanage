Add-Type -AssemblyName System.Drawing

$repoRoot = Split-Path -Parent $PSScriptRoot
$outputDirectory = Join-Path $repoRoot 'assets\icons'
[System.IO.Directory]::CreateDirectory($outputDirectory) | Out-Null

function New-BadmintonManagerIcon {
    param(
        [Parameter(Mandatory = $true)]
        [int]$Size,
        [Parameter(Mandatory = $true)]
        [string]$FileName
    )

    $bitmap = New-Object System.Drawing.Bitmap($Size, $Size)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

    $blue = [System.Drawing.ColorTranslator]::FromHtml('#2563eb')
    $lightBlue = [System.Drawing.ColorTranslator]::FromHtml('#dbeafe')
    $yellow = [System.Drawing.ColorTranslator]::FromHtml('#fbbf24')
    $white = [System.Drawing.Color]::White
    $graphics.Clear($blue)

    $whiteBrush = New-Object System.Drawing.SolidBrush($white)
    $lightBlueBrush = New-Object System.Drawing.SolidBrush($lightBlue)
    $yellowBrush = New-Object System.Drawing.SolidBrush($yellow)
    $bluePen = New-Object System.Drawing.Pen($blue, [Math]::Max(2, $Size * 0.018))

    $skirt = [System.Drawing.PointF[]]@(
        [System.Drawing.PointF]::new($Size * 0.31, $Size * 0.37),
        [System.Drawing.PointF]::new($Size * 0.69, $Size * 0.37),
        [System.Drawing.PointF]::new($Size * 0.58, $Size * 0.64),
        [System.Drawing.PointF]::new($Size * 0.42, $Size * 0.64)
    )
    $graphics.FillPolygon($whiteBrush, $skirt)

    foreach ($x in 0.40, 0.50, 0.60) {
        $graphics.DrawLine(
            $bluePen,
            [System.Drawing.PointF]::new($Size * $x, $Size * 0.39),
            [System.Drawing.PointF]::new($Size * (0.46 + (($x - 0.50) * 0.4)), $Size * 0.62)
        )
    }

    $graphics.FillEllipse($yellowBrush, $Size * 0.39, $Size * 0.20, $Size * 0.22, $Size * 0.17)
    $graphics.FillEllipse($lightBlueBrush, $Size * 0.405, $Size * 0.215, $Size * 0.19, $Size * 0.06)

    $font = New-Object System.Drawing.Font('Arial', ($Size * 0.19), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $format = New-Object System.Drawing.StringFormat
    $format.Alignment = [System.Drawing.StringAlignment]::Center
    $format.LineAlignment = [System.Drawing.StringAlignment]::Center
    $textArea = New-Object System.Drawing.RectangleF(0, ($Size * 0.68), $Size, ($Size * 0.20))
    $graphics.DrawString('BM', $font, $whiteBrush, $textArea, $format)

    $targetPath = Join-Path $outputDirectory $FileName
    $bitmap.Save($targetPath, [System.Drawing.Imaging.ImageFormat]::Png)

    $format.Dispose()
    $font.Dispose()
    $bluePen.Dispose()
    $yellowBrush.Dispose()
    $lightBlueBrush.Dispose()
    $whiteBrush.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()
}

New-BadmintonManagerIcon -Size 180 -FileName 'apple-touch-icon.png'
New-BadmintonManagerIcon -Size 192 -FileName 'icon-192.png'
New-BadmintonManagerIcon -Size 512 -FileName 'icon-512.png'
