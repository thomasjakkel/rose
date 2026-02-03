#!/usr/bin/env node

/**
 * JSON to CSV Converter for Pregnancy Data
 * 
 * Converts the filtered pregnancy JSON data into a flattened CSV format.
 * 
 * USAGE:
 *   node json_to_csv.js <input.json> <output.csv>
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
 * Convert JSON data to CSV rows
 */
function jsonToCsvRows(data) {
  const rows = [];
  
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
            
            // Build row in column order
            const row = CSV_COLUMNS.map(col => escapeCsvValue(rowData[col])).join(',');
            rows.push(row);
          }
        }
      }
    }
  }
  
  return rows.join('\n');
}

// =============================================================================
// CLI ENTRY POINT
// =============================================================================

function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.log('Usage: node json_to_csv.js <input.json> <output.csv>');
    console.log('');
    console.log('Converts filtered pregnancy JSON data to CSV format.');
    console.log('Each row represents one care visit (in-person or phone).');
    process.exit(1);
  }
  
  const inputPath = path.resolve(args[0]);
  const outputPath = path.resolve(args[1]);
  
  // Read input JSON
  console.log(`Reading input file: ${inputPath}`);
  let inputData;
  try {
    const rawData = fs.readFileSync(inputPath, 'utf8');
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
  const csvContent = jsonToCsvRows(inputData);
  
  // Write output CSV
  console.log(`Writing output file: ${outputPath}`);
  try {
    fs.writeFileSync(outputPath, csvContent, 'utf8');
  } catch (err) {
    console.error(`Error writing output file: ${err.message}`);
    process.exit(1);
  }
  
  // Calculate statistics
  const rowCount = csvContent.split('\n').length - 1; // Subtract header
  console.log('');
  console.log('Conversion complete!');
  console.log(`  Total rows: ${rowCount} (excluding header)`);
  console.log(`  Output: ${outputPath}`);
}

main();
