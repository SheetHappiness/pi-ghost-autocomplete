$ErrorActionPreference = 'Stop'
$file = [System.IO.File]::Open($env:PI_GHOST_TEST_LOCK, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
try {
    [Console]::WriteLine('locked')
    [Console]::Out.Flush()
    [Console]::ReadLine() | Out-Null
} finally {
    $file.Dispose()
}
