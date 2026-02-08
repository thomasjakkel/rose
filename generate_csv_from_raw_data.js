const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Usage: node generate_csv_from_raw_data.js <raw_data_folder>
const args = process.argv.slice(2);

if (args.length === 0) {
  console.error('Usage: node generate_csv_from_raw_data.js <raw_data_folder>');
  console.error('\nExample: node generate_csv_from_raw_data.js raw_data/');
  console.error('\nThis will process all JSON files in the folder and output results to output/');
  process.exit(1);
}

const rawDataFolder = args[0];
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
  execSync(
    `node "${path.join(roseDir, 'json_to_csv.js')}" "${mappedJson}" "${finalCsv}"`,
    { stdio: 'inherit', cwd: process.cwd() }
  );

  console.log('\n=== Pipeline Complete ===');
  console.log(`\nResults saved to ${outputDir}/:`);
  console.log('  • filtered.json      - Validated and flattened data');
  console.log('  • mapped.json        - Value-mapped data');
  console.log('  • final.csv          - Final CSV output');
  console.log('  • filter-report.txt  - Filtering statistics');
  console.log('  • mapping-report.txt - Mapping statistics');

} catch (error) {
  console.error('\n✗ Pipeline failed');
  console.error('Check the error messages above for details');
  process.exit(1);
}
