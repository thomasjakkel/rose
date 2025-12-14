#!/usr/bin/env node

/**
 * Pregnancy Data Filter Script
 * 
 * Filters large pregnancy datasets to extract only statistically relevant fields,
 * removing sensitive/personal information while preserving the nested data structure.
 * 
 * USAGE:
 *   node filter.js <input.json> <output.json>
 * 
 * OUTPUTS:
 *   - <output.json>  : Filtered dataset with only whitelisted properties
 *   - results.txt    : Processing report with statistics and skipped entries
 * 
 * CONFIGURATION:
 *   Edit the CONFIG object below to:
 *   - Adjust required fields for validation (CONFIG.required)
 *   - Modify property whitelists per entity (CONFIG.whitelist)
 *   - Change data_encr subsets (CONFIG.dataEncr)
 * 
 * VALIDATION:
 *   - Pregnancies are validated individually against CONFIG.required
 *   - Invalid pregnancies are removed from the client but logged to results.txt
 *   - Clients are skipped only if they have no valid pregnancies remaining
 */

const fs = require('fs');
const path = require('path');

// =============================================================================
// CONFIGURATION - Easily extendable property whitelists and validation rules
// =============================================================================

const CONFIG = {
  // Required fields validation - skip client if any of these are missing/null/empty
  // Adjust this section to change what makes a client valid
  required: {
    client: ['pregnancies'],           
    pregnancy: ['birth', 'cares_after', 'cares_after_phone'],  
    birth: ['children'],
  },

  // Property whitelists per entity type
  whitelist: {
    client: ['id', 'pregnancies'],
    
    pregnancy: [
      'id', 'id_client', 'data_encr', 'expected_birth_date',
      'birth', 'cares_after', 'cares_after_phone'
    ],
    
    birth: ['id', 'id_pregnancy', 'data_encr', 'children'],
    
    child: [
      'id', 'id_birth', 'date_birth', 'data_encr',
      'created_at', 'updated_at', 'deleted_at',
      'created_by', 'updated_by', 'in_dashboard',
      'pregnancy_id', 'client_id'
    ],
    
    careAfter: ['id', 'id_pregnancy', 'data_encr', 'date_start', 'date_end'],
    
    careAfterPhone: [
      'id', 'id_user', 'id_pregnancy',
      'date_start', 'date_end', 'is_breast_feeding'
    ],
  },

  // data_encr property subsets per entity type
  dataEncr: {
    pregnancy: ['fields-type', 'egt', 'grav', 'para', 'stillwunsch'],
    
    birth: ['fields-type', 'geburts-modus', 'blutverlust', 'mother-entlassungdatum'],
    
    child: ['fields-type', 'birth_date', 'birth_time'],
    
    // For careAfter, also keep specific 'kind-{id}-*' pattern keys
    careAfter: [
      'stillt', 'child-tab', 'ibds-left', 'ibds-right',
      'care_length', 'is_first_care', 'laktierend-left', 'laktierend-right',
      'regelrechtes-wochenbett'
    ],
    
    // Dynamic patterns for careAfter data_encr (use {id} as placeholder for child ID)
    careAfterDynamicPatterns: [
      'kind-{id}-nahrung',
      'kind-{id}-physiologisches-neugeborenes'
    ],
  },
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Pick only specified properties from an object
 */
function pickProperties(obj, keys) {
  if (!obj || typeof obj !== 'object') return obj;
  
  const result = {};
  for (const key of keys) {
    if (key in obj) {
      result[key] = obj[key];
    }
  }
  return result;
}

/**
 * Filter data_encr object, keeping only allowed keys
 * Optionally keeps keys matching specific suffix patterns (e.g., 'kind-{id}-nahrung')
 */
function filterDataEncr(dataEncr, allowedKeys, dynamicPatterns = null) {
  if (!dataEncr || typeof dataEncr !== 'object') return dataEncr;
  
  const result = {};
  
  for (const key of Object.keys(dataEncr)) {
    // Check if key is in allowed list
    if (allowedKeys.includes(key)) {
      result[key] = dataEncr[key];
    }
    // Check if key matches dynamic patterns (e.g., 'kind-{id}-nahrung', 'kind-{id}-physiologisches-neugeborenes')
    else if (dynamicPatterns && dynamicPatterns.some(pattern => matchesDynamicPattern(key, pattern))) {
      result[key] = dataEncr[key];
    }
  }
  
  return result;
}

/**
 * Check if a key matches a dynamic pattern like 'kind-{id}-nahrung'
 * The {id} part matches any numeric ID
 */
function matchesDynamicPattern(key, pattern) {
  // Convert pattern like 'kind-{id}-nahrung' to regex 'kind-\d+-nahrung'
  const regexPattern = pattern.replace('{id}', '\\d+');
  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(key);
}

/**
 * Check if a value is valid (not null, not undefined, and if array - not empty)
 */
function isValidValue(value, checkNonEmptyArray = false) {
  if (value === null || value === undefined) return false;
  if (checkNonEmptyArray && Array.isArray(value) && value.length === 0) return false;
  return true;
}

// =============================================================================
// VALIDATION FUNCTIONS
// =============================================================================

/**
 * Validate a single entity against its required fields from CONFIG
 * Returns { valid: boolean, missingField: string | null }
 */
function validateEntity(entity, requiredFields, checkArrayNonEmpty = false) {
  for (const field of requiredFields) {
    const value = entity?.[field];
    if (!isValidValue(value, checkArrayNonEmpty)) {
      return { valid: false, missingField: field };
    }
  }
  return { valid: true, missingField: null };
}

/**
 * Validate a single pregnancy against required fields defined in CONFIG.required
 * Returns { valid: boolean, reason: string | null }
 */
function validatePregnancy(pregnancy) {
  // Check pregnancy-level required fields (arrays must be non-empty)
  const pregnancyValidation = validateEntity(pregnancy, CONFIG.required.pregnancy, true);
  if (!pregnancyValidation.valid) {
    return { 
      valid: false, 
      reason: `Missing required field 'pregnancy.${pregnancyValidation.missingField}' (defined in CONFIG.required.pregnancy)` 
    };
  }
  
  // Check birth-level required fields (children must be non-empty array)
  if (pregnancy.birth) {
    const birthValidation = validateEntity(pregnancy.birth, CONFIG.required.birth, true);
    if (!birthValidation.valid) {
      return { 
        valid: false, 
        reason: `Missing required field 'birth.${birthValidation.missingField}' (defined in CONFIG.required.birth)` 
      };
    }
  }

  return { valid: true, reason: null };
}

/**
 * Validate a client object against required fields defined in CONFIG.required
 * Returns { valid: boolean, reason: string | null }
 */
function validateClient(client) {
  // Check client-level required fields (pregnancies must be non-empty array)
  const clientValidation = validateEntity(client, CONFIG.required.client, true);
  if (!clientValidation.valid) {
    return { 
      valid: false, 
      reason: `Missing required field 'client.${clientValidation.missingField}' (defined in CONFIG.required.client)` 
    };
  }

  return { valid: true, reason: null };
}

// =============================================================================
// FILTER FUNCTIONS
// =============================================================================

function filterCareAfterPhone(careAfterPhone) {
  return pickProperties(careAfterPhone, CONFIG.whitelist.careAfterPhone);
}

function filterCareAfter(careAfter) {
  const filtered = pickProperties(careAfter, CONFIG.whitelist.careAfter);
  
  if (filtered.data_encr) {
    // Keep allowed keys + specific 'kind-{id}-*' pattern keys
    filtered.data_encr = filterDataEncr(
      filtered.data_encr,
      CONFIG.dataEncr.careAfter,
      CONFIG.dataEncr.careAfterDynamicPatterns
    );
  }
  
  return filtered;
}

function filterChild(child) {
  const filtered = pickProperties(child, CONFIG.whitelist.child);
  
  if (filtered.data_encr) {
    filtered.data_encr = filterDataEncr(filtered.data_encr, CONFIG.dataEncr.child);
  }
  
  return filtered;
}

function filterBirth(birth) {
  if (!birth) return null;
  
  const filtered = pickProperties(birth, CONFIG.whitelist.birth);
  
  if (filtered.data_encr) {
    filtered.data_encr = filterDataEncr(filtered.data_encr, CONFIG.dataEncr.birth);
  }
  
  if (filtered.children && Array.isArray(filtered.children)) {
    filtered.children = filtered.children.map(filterChild);
  }
  
  return filtered;
}

function filterPregnancy(pregnancy) {
  const filtered = pickProperties(pregnancy, CONFIG.whitelist.pregnancy);
  
  if (filtered.data_encr) {
    filtered.data_encr = filterDataEncr(filtered.data_encr, CONFIG.dataEncr.pregnancy);
  }
  
  if (filtered.birth) {
    filtered.birth = filterBirth(filtered.birth);
  }
  
  if (filtered.cares_after && Array.isArray(filtered.cares_after)) {
    filtered.cares_after = filtered.cares_after.map(filterCareAfter);
  }
  
  if (filtered.cares_after_phone && Array.isArray(filtered.cares_after_phone)) {
    filtered.cares_after_phone = filtered.cares_after_phone.map(filterCareAfterPhone);
  }
  
  return filtered;
}

function filterClient(client) {
  const filtered = pickProperties(client, CONFIG.whitelist.client);
  
  if (filtered.pregnancies && Array.isArray(filtered.pregnancies)) {
    filtered.pregnancies = filtered.pregnancies.map(filterPregnancy);
  }
  
  return filtered;
}

// =============================================================================
// MAIN PROCESSING
// =============================================================================

function processData(inputData) {
  const results = {
    totalClients: 0,
    successCount: 0,
    skippedClientsCount: 0,
    skippedClients: [],
    skippedPregnanciesCount: 0,
    skippedPregnancies: [],
  };
  
  const outputData = [];
  
  if (!Array.isArray(inputData)) {
    console.error('Error: Input data must be an array');
    process.exit(1);
  }
  
  results.totalClients = inputData.length;
  
  for (const client of inputData) {
    // First check client-level validation
    const clientValidation = validateClient(client);
    
    if (!clientValidation.valid) {
      results.skippedClientsCount++;
      results.skippedClients.push({
        id: client.id,
        reason: clientValidation.reason,
      });
      continue;
    }
    
    // Validate each pregnancy and filter out invalid ones
    const validPregnancies = [];
    
    for (const pregnancy of client.pregnancies) {
      const pregnancyValidation = validatePregnancy(pregnancy);
      
      if (pregnancyValidation.valid) {
        validPregnancies.push(pregnancy);
      } else {
        results.skippedPregnanciesCount++;
        results.skippedPregnancies.push({
          clientId: client.id,
          pregnancyId: pregnancy.id,
          reason: pregnancyValidation.reason,
        });
      }
    }
    
    // If no valid pregnancies remain, skip the entire client
    if (validPregnancies.length === 0) {
      results.skippedClientsCount++;
      results.skippedClients.push({
        id: client.id,
        reason: 'No valid pregnancies remaining after validation',
      });
      continue;
    }
    
    // Create a modified client with only valid pregnancies
    const clientWithValidPregnancies = { ...client, pregnancies: validPregnancies };
    const filteredClient = filterClient(clientWithValidPregnancies);
    outputData.push(filteredClient);
    results.successCount++;
  }
  
  return { outputData, results };
}

function generateResultsReport(results) {
  const lines = [
    '='.repeat(60),
    'DATA FILTERING RESULTS REPORT',
    '='.repeat(60),
    '',
    `Run Date: ${new Date().toISOString()}`,
    '',
    '-'.repeat(60),
    'SUMMARY',
    '-'.repeat(60),
    `Total Clients Processed: ${results.totalClients}`,
    `Successfully Transformed: ${results.successCount}`,
    `Skipped Clients: ${results.skippedClientsCount}`,
    `Skipped Pregnancies: ${results.skippedPregnanciesCount}`,
    '',
  ];
  
  if (results.skippedPregnancies.length > 0) {
    lines.push('-'.repeat(60));
    lines.push('SKIPPED PREGNANCIES');
    lines.push('-'.repeat(60));
    
    for (const skipped of results.skippedPregnancies) {
      lines.push(`  Client ID: ${skipped.clientId}, Pregnancy ID: ${skipped.pregnancyId}`);
      lines.push(`    Reason: ${skipped.reason}`);
      lines.push('');
    }
  }
  
  if (results.skippedClients.length > 0) {
    lines.push('-'.repeat(60));
    lines.push('SKIPPED CLIENTS');
    lines.push('-'.repeat(60));
    
    for (const skipped of results.skippedClients) {
      lines.push(`  Client ID: ${skipped.id}`);
      lines.push(`    Reason: ${skipped.reason}`);
      lines.push('');
    }
  }
  
  lines.push('='.repeat(60));
  lines.push('END OF REPORT');
  lines.push('='.repeat(60));
  
  return lines.join('\n');
}

// =============================================================================
// CLI ENTRY POINT
// =============================================================================

function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.log('Usage: node filter.js <input.json> <output.json>');
    console.log('');
    console.log('This script filters pregnancy data to keep only statistical fields.');
    console.log('A results.txt file will be generated alongside the output file.');
    process.exit(1);
  }
  
  const inputPath = path.resolve(args[0]);
  const outputPath = path.resolve(args[1]);
  const resultsPath = path.join(path.dirname(outputPath), 'results.txt');
  
  // Read input file
  console.log(`Reading input file: ${inputPath}`);
  let inputData;
  try {
    const rawData = fs.readFileSync(inputPath, 'utf8');
    inputData = JSON.parse(rawData);
  } catch (err) {
    console.error(`Error reading input file: ${err.message}`);
    process.exit(1);
  }
  
  // Process data
  console.log('Processing data...');
  const { outputData, results } = processData(inputData);
  
  // Write output JSON
  console.log(`Writing output file: ${outputPath}`);
  try {
    fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2), 'utf8');
  } catch (err) {
    console.error(`Error writing output file: ${err.message}`);
    process.exit(1);
  }
  
  // Write results report
  console.log(`Writing results report: ${resultsPath}`);
  try {
    const report = generateResultsReport(results);
    fs.writeFileSync(resultsPath, report, 'utf8');
  } catch (err) {
    console.error(`Error writing results file: ${err.message}`);
    process.exit(1);
  }
  
  // Print summary to console
  console.log('');
  console.log('Processing complete!');
  console.log(`  Total clients: ${results.totalClients}`);
  console.log(`  Transformed: ${results.successCount}`);
  console.log(`  Skipped clients: ${results.skippedClientsCount}`);
  console.log(`  Skipped pregnancies: ${results.skippedPregnanciesCount}`);
}

main();
