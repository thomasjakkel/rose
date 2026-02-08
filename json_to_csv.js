#!/usr/bin/env node

/**
 * JSON to CSV Converter for Pregnancy Data
 * 
 * Converts the filtered pregnancy JSON data into a flattened CSV format.
 * 
 * USAGE:
 *   node json_to_csv.js <input.json> <output.csv> [--skip-rows-for-values <value1,value2,...>]
 * 
 * OPTIONS:
 *   --skip-rows-for-values  Comma-separated list of values to skip rows for.
 *                           If any column in a row contains one of these values,
 *                           the entire row is skipped.
 *                           Example: --skip-rows-for-values -1,0
 * 
 * CSV STRUCTURE:
 *   - Each row represents one care visit (either in-person or phone)
 *   - Client and pregnancy data is repeated for each care visit
 *   - Column 'is_home_visit' distinguishes visit type:
 *     * 1 = in-person visit (cares_after)
 *     * 0 = phone consultation (cares_after_phone)
 * 
 * COLUMNS:
 *   Client level: client_id
 *   Pregnancy level: pregnancy_id, grav, para, birth_mode, blood_loss, 
 *                    discharge_date, date_birth
 *   Care level: care_id, date_start, date_end, is_home_visit,
 *               duration_of_visit, age_of_child, time_since_discharge
 *   In-person only: is_first_care, baby_food, breastfeed_type
 *   Phone only: is_breast_feeding
 */

const fs = require('fs');
const path = require('path');

// =============================================================================
// CSV GENERATION
// =============================================================================

/**
 * Escape CSV value (handle quotes and commas)
 */
function escapeCsvValue(value) {
  if (value === null || value === undefined) {
    return '';
  }
  
  const str = String(value);
  
  // If value contains comma, quote, or newline, wrap in quotes and escape internal quotes
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  
  return str;
}

/**
 * Define column order for CSV
 */
const CSV_COLUMNS = [
  // Client level
  'client_id',
  
  // Pregnancy level
  'pregnancy_id',
  'grav',
  'para',
  'birth_mode',
  'blood_loss',
  'discharge_date',
  'date_birth',
  
  // Care type identifier
  'is_home_visit',
  
  // Care level (shared)
  'care_id',
  'date_start',
  'date_end',
  'duration_of_visit',
  'age_of_child',
  'time_since_discharge',
  
  // In-person visit specific
  'is_first_care',
  'baby_food',
  'breastfeed_type',
  
  // Phone consultation specific
  'is_breast_feeding',
];

/**
 * Check if a row should be skipped based on skip values
 */
function shouldSkipRow(rowData, skipValues) {
  if (!skipValues || skipValues.length === 0) {
    return false;
  }
  
  // Check if any column value matches any skip value
  for (const col of CSV_COLUMNS) {
    const value = String(rowData[col] ?? '');
    if (skipValues.includes(value)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Convert JSON data to CSV rows
 * @param {Array} data - Array of client data
 * @param {Array} skipValues - Array of string values to skip rows for (optional)
 */
function jsonToCsvRows(data, skipValues = []) {
  const rows = [];
  let skippedCount = 0;
  
  // Add header row
  rows.push(CSV_COLUMNS.map(escapeCsvValue).join(','));
  
  // Process each client
  for (const client of data) {
    const clientId = client.id;
    
    // Process each pregnancy
    if (client.pregnancies && Array.isArray(client.pregnancies)) {
      for (const pregnancy of client.pregnancies) {
        const pregnancyData = {
          client_id: clientId,
          pregnancy_id: pregnancy.id,
          grav: pregnancy.grav,
          para: pregnancy.para,
          birth_mode: pregnancy.birth_mode,
          blood_loss: pregnancy.blood_loss,
          discharge_date: pregnancy.discharge_date,
          date_birth: pregnancy.date_birth,
        };
        
        // Process cares_after (in-person visits)
        if (pregnancy.cares_after && Array.isArray(pregnancy.cares_after)) {
          for (const care of pregnancy.cares_after) {
            const rowData = {
              ...pregnancyData,
              is_home_visit: 1,
              care_id: care.id,
              date_start: care.date_start,
              date_end: care.date_end,
              duration_of_visit: care.duration_of_visit,
              age_of_child: care.age_of_child,
              time_since_discharge: care.time_since_discharge,
              is_first_care: care.is_first_care,
              baby_food: care.baby_food,
              breastfeed_type: care.breastfeed_type,
              is_breast_feeding: '', // Empty for in-person visits
            };
            
            // Skip row if it contains any skip values
            if (shouldSkipRow(rowData, skipValues)) {
              skippedCount++;
              continue;
            }
            
            // Build row in column order
            const row = CSV_COLUMNS.map(col => escapeCsvValue(rowData[col])).join(',');
            rows.push(row);
          }
        }
        
        // Process cares_after_phone (phone consultations)
        if (pregnancy.cares_after_phone && Array.isArray(pregnancy.cares_after_phone)) {
          for (const care of pregnancy.cares_after_phone) {
            const rowData = {
              ...pregnancyData,
              is_home_visit: 0,
              care_id: care.id,
              date_start: care.date_start,
              date_end: care.date_end,
              duration_of_visit: care.duration_of_visit,
              age_of_child: care.age_of_child,
              time_since_discharge: care.time_since_discharge,
              is_first_care: '', // Empty for phone consultations
              baby_food: '', // Empty for phone consultations
              breastfeed_type: '', // Empty for phone consultations
              is_breast_feeding: care.is_breast_feeding,
            };
            
            // Skip row if it contains any skip values
            if (shouldSkipRow(rowData, skipValues)) {
              skippedCount++;
              continue;
            }
            
            // Build row in column order
            const row = CSV_COLUMNS.map(col => escapeCsvValue(rowData[col])).join(',');
            rows.push(row);
          }
        }
      }
    }
  }
  
  return { csvContent: rows.join('\n'), skippedCount };
}

// =============================================================================
// CLI ENTRY POINT
// =============================================================================

function main() {
  const args = process.argv.slice(2);
  
  // Parse arguments
  let inputPath, outputPath;
  let skipValues = [];
  
  // Find positional arguments and flags
  const positionalArgs = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--skip-rows-for-values') {
      if (i + 1 < args.length) {
        skipValues = args[i + 1].split(',').map(v => v.trim());
        i++; // Skip next arg
      }
    } else {
      positionalArgs.push(args[i]);
    }
  }
  
  if (positionalArgs.length < 2) {
    console.log('Usage: node json_to_csv.js <input.json> <output.csv> [--skip-rows-for-values <value1,value2,...>]');
    console.log('');
    console.log('Converts filtered pregnancy JSON data to CSV format.');
    console.log('Each row represents one care visit (in-person or phone).');
    console.log('');
    console.log('Options:');
    console.log('  --skip-rows-for-values  Comma-separated list of values to skip rows for');
    console.log('                          Example: --skip-rows-for-values -1,0');
    process.exit(1);
  }
  
  inputPath = positionalArgs[0];
  outputPath = positionalArgs[1];
  
  const resolvedInputPath = path.resolve(inputPath);
  const resolvedOutputPath = path.resolve(outputPath);
  
  // Show skip values if provided
  if (skipValues.length > 0) {
    console.log(`Skip values configured: [${skipValues.join(', ')}]`);
  }
  
  // Read input JSON
  console.log(`Reading input file: ${resolvedInputPath}`);
  let inputData;
  try {
    const rawData = fs.readFileSync(resolvedInputPath, 'utf8');
    inputData = JSON.parse(rawData);
  } catch (err) {
    console.error(`Error reading input file: ${err.message}`);
    process.exit(1);
  }
  
  // Validate input
  if (!Array.isArray(inputData)) {
    console.error('Error: Input JSON must be an array of clients');
    process.exit(1);
  }
  
  // Convert to CSV
  console.log('Converting to CSV...');
  const { csvContent, skippedCount } = jsonToCsvRows(inputData, skipValues);
  
  // Write output CSV
  console.log(`Writing output file: ${resolvedOutputPath}`);
  try {
    fs.writeFileSync(resolvedOutputPath, csvContent, 'utf8');
  } catch (err) {
    console.error(`Error writing output file: ${err.message}`);
    process.exit(1);
  }
  
  // Calculate statistics
  const rowCount = csvContent.split('\n').length - 1; // Subtract header
  console.log('');
  console.log('Conversion complete!');
  console.log(`  Total rows: ${rowCount} (excluding header)`);
  if (skippedCount > 0) {
    console.log(`  Skipped rows: ${skippedCount}`);
  }
  console.log(`  Output: ${resolvedOutputPath}`);
}

main();
