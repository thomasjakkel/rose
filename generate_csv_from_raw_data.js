const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Usage: node generate_csv_from_raw_data.js <raw_data_folder> [--skip-rows-for-values <value1,value2,...>]
const args = process.argv.slice(2);

// Parse arguments
let rawDataFolder;
let skipRowsForValues = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--skip-rows-for-values') {
    if (i + 1 < args.length) {
      skipRowsForValues = args[i + 1];
      i++; // Skip next arg
    }
  } else if (!rawDataFolder) {
    rawDataFolder = args[i];
  }
}

if (!rawDataFolder) {
  console.error('Usage: node generate_csv_from_raw_data.js <raw_data_folder> [--skip-rows-for-values <value1,value2,...>]');
  console.error('\nExample: node generate_csv_from_raw_data.js raw_data/');
  console.error('         node generate_csv_from_raw_data.js raw_data/ --skip-rows-for-values -1,0');
  console.error('\nThis will process all JSON files in the folder and output results to output/');
  console.error('\nOptions:');
  console.error('  --skip-rows-for-values  Comma-separated list of values to skip rows for in CSV output');
  console.error('                          Example: --skip-rows-for-values -1,0');
  process.exit(1);
}
const outputDir = 'output';
const roseDir = path.join(__dirname);

// Validate input folder exists
if (!fs.existsSync(rawDataFolder)) {
  console.error(`Error: Input folder "${rawDataFolder}" does not exist`);
  process.exit(1);
}

// Create output directory
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
  console.log(`✓ Created output directory: ${outputDir}/\n`);
}

// Define file paths
const filteredJson = path.join(outputDir, 'filtered.json');
const mappedJson = path.join(outputDir, 'mapped.json');
const finalCsv = path.join(outputDir, 'final.csv');
const mappingRules = 'mapping_rules.json';

console.log('=== Pregnancy Data Processing Pipeline ===\n');
console.log(`Input: ${rawDataFolder}`);
console.log(`Output: ${outputDir}/\n`);

try {
  // Step 1: Filter and validate
  console.log('[1/3] Filtering and validating data...');
  execSync(
    `node "${path.join(roseDir, 'filter.js')}" "${rawDataFolder}" "${filteredJson}"`,
    { stdio: 'inherit', cwd: process.cwd() }
  );
  
  // Move filter report to output folder
  if (fs.existsSync('filter-report.txt')) {
    fs.renameSync('filter-report.txt', path.join(outputDir, 'filter-report.txt'));
  }

  // Step 2: Map values
  console.log('\n[2/3] Mapping string values to numeric codes...');
  execSync(
    `node "${path.join(roseDir, 'map_values.js')}" "${filteredJson}" "${mappingRules}" "${mappedJson}"`,
    { stdio: 'inherit', cwd: process.cwd() }
  );
  
  // Move mapping report to output folder
  if (fs.existsSync('mapping-report.txt')) {
    fs.renameSync('mapping-report.txt', path.join(outputDir, 'mapping-report.txt'));
  }

  // Step 3: Export to CSV
  console.log('\n[3/3] Exporting to CSV...');
  const csvCmd = skipRowsForValues 
    ? `node "${path.join(roseDir, 'json_to_csv.js')}" "${mappedJson}" "${finalCsv}" --skip-rows-for-values "${skipRowsForValues}"`
    : `node "${path.join(roseDir, 'json_to_csv.js')}" "${mappedJson}" "${finalCsv}"`;
  execSync(csvCmd, { stdio: 'inherit', cwd: process.cwd() });

  console.log('\n=== Pipeline Complete ===');
  console.log(`\nResults saved to ${outputDir}/:`);
  console.log('  • filtered.json      - Validated and flattened data');
  console.log('  • mapped.json        - Value-mapped data');
  console.log('  • final.csv          - Final CSV output');
  if (skipRowsForValues) {
    console.log(`                         (rows with values [${skipRowsForValues}] were skipped)`);
  }
  console.log('  • filter-report.txt  - Filtering statistics');
  console.log('  • mapping-report.txt - Mapping statistics');

} catch (error) {
  console.error('\n✗ Pipeline failed');
  console.error('Check the error messages above for details');
  process.exit(1);
}
