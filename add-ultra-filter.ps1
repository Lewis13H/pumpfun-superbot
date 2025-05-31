// Check if we need to modify the filter
const filterContent = Get-Content src\discovery\smart-token-filter.ts -Raw

# Find the line after new_with_traction filter
$insertPoint = $filterContent.IndexOf("this.filters.set('new_with_traction'")
$endOfBlock = $filterContent.IndexOf("});", $insertPoint) + 3

# Insert new filter
$newFilter = @"

      this.filters.set('ultra_relaxed', {
        minLiquidity: 0,     // No liquidity requirement
        requireLiquidity: false,
        requireName: false   // No name requirement
      });
"@

$newContent = $filterContent.Insert($endOfBlock, $newFilter)
Set-Content src\discovery\smart-token-filter.ts $newContent
