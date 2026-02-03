#!/usr/bin/env node

/**
 * Pregnancy Data Filter Script
 * 
 * Filters large pregnancy datasets to extract only statistically relevant fields,
 * removing sensitive/personal information while preserving the nested data structure.
 * 
 * USAGE:
 *   node filter.js <input.json|input_folder/> <output.json>
 * 
 *   Input can be either:
 *   - A single JSON file: node filter.js data.json output.json
 *   - A directory with multiple JSON files: node filter.js data_folder/ output.json
 *     (All .json files in the directory will be combined into one output)
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
    
    // Pregnancy properties - flattened structure
    pregnancy: ['id', 'cares_after', 'cares_after_phone'],
    
    // CareAfter properties - flattened data_encr
    careAfter: ['id', 'date_start', 'date_end'],
    
    careAfterPhone: [
      'id', 'date_start', 'date_end', 'is_breast_feeding'
    ],
  },

  // Properties to extract and flatten from nested objects
  flatten: {
    // Extract from pregnancy.data_encr and add to pregnancy level
    pregnancyDataEncr: ['grav', 'para'],
    
    // Extract from pregnancy.birth.data_encr and add to pregnancy level
    // Map old names to new names: 'old-name': 'new-name'
    birthDataEncr: {
      'geburts-modus': 'birth_mode',
      'blutverlust': 'blood_loss',
      'mother-entlassungdatum': 'discharge_date'
    },
    
    // Extract from cares_after.data_encr and add to cares_after level
    careAfterDataEncr: ['stillt', 'is_first_care', 'primar-abgestillt', 'abgestillt', 'stillt-teilweise', 'frau-pumpt-ab'],
    
    // Dynamic patterns for careAfter data_encr (use {id} as placeholder for child ID)
    careAfterDynamicPatterns: [
      'kind-{id}-nahrung'
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
/**
 * Extract specific properties from data_encr object
 * Supports both array format and object format (for renaming)
 */
function extractDataEncrProperties(dataEncr, allowedKeysOrMap, dynamicPatterns = null) {
  if (!dataEncr || typeof dataEncr !== 'object') return {};
  
  const result = {};
  
  // Check if allowedKeysOrMap is an object (mapping) or array (simple list)
  const isMapping = !Array.isArray(allowedKeysOrMap);
  
  for (const key of Object.keys(dataEncr)) {
    if (isMapping) {
      // Object format: { 'old-name': 'new-name' }
      if (key in allowedKeysOrMap) {
        const newKey = allowedKeysOrMap[key];
        result[newKey] = dataEncr[key];
      }
    } else {
      // Array format: ['key1', 'key2']
      if (allowedKeysOrMap.includes(key)) {
        result[key] = dataEncr[key];
      }
      // Check if key matches dynamic patterns
      else if (dynamicPatterns && dynamicPatterns.some(pattern => matchesDynamicPattern(key, pattern))) {
        result[key] = dataEncr[key];
      }
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

/**
 * Parse date string that can be in multiple formats and convert to ISO format
 * Supports: 'DD.MM.YYYY HH:MM', 'YYYY-MM-DD HH:MM:SS', etc.
 * Returns: ISO format string 'YYYY-MM-DD HH:MM:SS' or null
 */
function parseAndConvertDate(dateString) {
  if (!dateString) return null;
  
  try {
    // Check if it's German format: DD.MM.YYYY HH:MM
    const germanFormat = /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})$/;
    const match = dateString.match(germanFormat);
    
    if (match) {
      const [, day, month, year, hours, minutes] = match;
      // Convert to ISO format: YYYY-MM-DD HH:MM:SS
      return `${year}-${month}-${day} ${hours}:${minutes}:00`;
    }
    
    // Already in standard format, return as-is
    return dateString;
  } catch (e) {
    return null;
  }
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
    
    // Check that children array has exactly one child
    if (pregnancy.birth.children && Array.isArray(pregnancy.birth.children)) {
      if (pregnancy.birth.children.length !== 1) {
        return {
          valid: false,
          reason: `Birth has ${pregnancy.birth.children.length} children (expected exactly 1 child)`
        };
      }
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

function filterCareAfterPhone(careAfterPhone, dateBirth, dischargeDate) {
  const filtered = pickProperties(careAfterPhone, CONFIG.whitelist.careAfterPhone);
  
  // Calculate duration_of_visit in minutes
  if (filtered.date_start && filtered.date_end) {
    const startTime = new Date(filtered.date_start);
    const endTime = new Date(filtered.date_end);
    if (startTime && endTime && !isNaN(startTime) && !isNaN(endTime)) {
      const durationMinutes = Math.round((endTime - startTime) / 1000 / 60);
      filtered.duration_of_visit = durationMinutes;
    }
  }
  
  // Calculate age_of_child in hours (time between birth and visit start)
  if (dateBirth && filtered.date_start) {
    const birthTime = new Date(dateBirth);
    const visitStartTime = new Date(filtered.date_start);
    if (birthTime && visitStartTime && !isNaN(birthTime) && !isNaN(visitStartTime)) {
      const ageHours = Math.round((visitStartTime - birthTime) / 1000 / 60 / 60);
      filtered.age_of_child = ageHours;
    }
  }
  
  // Calculate time_since_discharge in hours (time between discharge and visit start)
  if (dischargeDate && filtered.date_start) {
    const dischargeTime = new Date(dischargeDate);
    const visitStartTime = new Date(filtered.date_start);
    if (dischargeTime && visitStartTime && !isNaN(dischargeTime) && !isNaN(visitStartTime)) {
      const hoursSinceDischarge = Math.round((visitStartTime - dischargeTime) / 1000 / 60 / 60);
      filtered.time_since_discharge = hoursSinceDischarge;
    }
  }
  
  return filtered;
}

function filterCareAfter(careAfter, dateBirth, dischargeDate, pregnancyId) {
  // Pick basic properties
  const filtered = pickProperties(careAfter, CONFIG.whitelist.careAfter);
  const careAfterId = careAfter.id;
  
  // Extract and flatten data_encr properties
  if (careAfter.data_encr) {
    const dataEncrProps = extractDataEncrProperties(
      careAfter.data_encr,
      CONFIG.flatten.careAfterDataEncr,
      CONFIG.flatten.careAfterDynamicPatterns
    );
    
    // Rename kind-{id}-nahrung to baby_food
    for (const key of Object.keys(dataEncrProps)) {
      if (key.match(/^kind-\d+-nahrung$/)) {
        dataEncrProps.baby_food = dataEncrProps[key];
        delete dataEncrProps[key];
      }
    }
    
    // Determine breastfeed_type based on which property is set
    const breastfeedingProps = ['stillt', 'primar-abgestillt', 'abgestillt', 'stillt-teilweise', 'frau-pumpt-ab'];
    const foundProps = [];
    
    for (const prop of breastfeedingProps) {
      if (dataEncrProps[prop]) {
        foundProps.push(prop);
      }
    }
    
    // Use default if none or multiple properties are set
    if (foundProps.length === 1) {
      dataEncrProps.breastfeed_type = foundProps[0];
    } else {
      dataEncrProps.breastfeed_type = 'stillt-teilweise';
      // Track default usage
      if (typeof filterCareAfter.defaultBreastfeedCount === 'undefined') {
        filterCareAfter.defaultBreastfeedCount = 0;
        filterCareAfter.defaultBreastfeedEntries = [];
      }
      filterCareAfter.defaultBreastfeedCount++;
      if (pregnancyId && careAfterId) {
        filterCareAfter.defaultBreastfeedEntries.push({
          pregnancyId: pregnancyId,
          careAfterId: careAfterId
        });
      }
    }
    
    // Remove individual breastfeeding properties, keep only breastfeed_type
    for (const prop of breastfeedingProps) {
      delete dataEncrProps[prop];
    }
    
    // Merge flattened properties into filtered object
    Object.assign(filtered, dataEncrProps);
  }
  
  // Calculate duration_of_visit in minutes
  if (filtered.date_start && filtered.date_end) {
    const startTime = new Date(filtered.date_start);
    const endTime = new Date(filtered.date_end);
    if (startTime && endTime && !isNaN(startTime) && !isNaN(endTime)) {
      const durationMinutes = Math.round((endTime - startTime) / 1000 / 60);
      filtered.duration_of_visit = durationMinutes;
    }
  }
  
  // Calculate age_of_child in hours (time between birth and visit start)
  if (dateBirth && filtered.date_start) {
    const birthTime = new Date(dateBirth);
    const visitStartTime = new Date(filtered.date_start);
    if (birthTime && visitStartTime && !isNaN(birthTime) && !isNaN(visitStartTime)) {
      const ageHours = Math.round((visitStartTime - birthTime) / 1000 / 60 / 60);
      filtered.age_of_child = ageHours;
    }
  }
  
  // Calculate time_since_discharge in hours (time between discharge and visit start)
  if (dischargeDate && filtered.date_start) {
    const dischargeTime = new Date(dischargeDate);
    const visitStartTime = new Date(filtered.date_start);
    if (dischargeTime && visitStartTime && !isNaN(dischargeTime) && !isNaN(visitStartTime)) {
      const hoursSinceDischarge = Math.round((visitStartTime - dischargeTime) / 1000 / 60 / 60);
      filtered.time_since_discharge = hoursSinceDischarge;
    }
  }
  
  return filtered;
}

function filterChild(child) {
  return pickProperties(child, CONFIG.whitelist.child);
}

function filterPregnancy(pregnancy) {
  // Create result object with properties in specific order
  const filtered = {};
  
  // 1. Add pregnancy id first
  filtered.id = pregnancy.id;
  
  // 2. Extract and flatten pregnancy.data_encr properties (grav, para)
  if (pregnancy.data_encr) {
    const pregnancyDataEncrProps = extractDataEncrProperties(
      pregnancy.data_encr,
      CONFIG.flatten.pregnancyDataEncr
    );
    Object.assign(filtered, pregnancyDataEncrProps);
  }
  
  // 3. Extract and flatten birth.data_encr properties (with renaming)
  if (pregnancy.birth && pregnancy.birth.data_encr) {
    const birthDataEncrProps = extractDataEncrProperties(
      pregnancy.birth.data_encr,
      CONFIG.flatten.birthDataEncr
    );
    Object.assign(filtered, birthDataEncrProps);
    
    // Convert discharge_date from German format to ISO format
    if (filtered.discharge_date) {
      filtered.discharge_date = parseAndConvertDate(filtered.discharge_date);
    }
  }
  
  // 4. Extract date_birth from the single child and flatten to pregnancy level
  if (pregnancy.birth && pregnancy.birth.children && Array.isArray(pregnancy.birth.children) && pregnancy.birth.children.length === 1) {
    const child = pregnancy.birth.children[0];
    if (child.date_birth) {
      // Convert German date format to ISO format for consistency
      filtered.date_birth = parseAndConvertDate(child.date_birth);
    }
  }
  
  // 5. Filter cares_after array (at the end) and pass pregnancy data for calculations
  if (pregnancy.cares_after && Array.isArray(pregnancy.cares_after)) {
    filtered.cares_after = pregnancy.cares_after.map(care => 
      filterCareAfter(care, filtered.date_birth, filtered.discharge_date, pregnancy.id)
    );
  }
  
  // 6. Filter cares_after_phone array (at the end)
  if (pregnancy.cares_after_phone && Array.isArray(pregnancy.cares_after_phone)) {
    filtered.cares_after_phone = pregnancy.cares_after_phone.map(care => 
      filterCareAfterPhone(care, filtered.date_birth, filtered.discharge_date)
    );
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
  // Reset default breastfeed counter
  filterCareAfter.defaultBreastfeedCount = 0;
  filterCareAfter.defaultBreastfeedEntries = [];
  
  const results = {
    totalClients: 0,
    successCount: 0,
    skippedClientsCount: 0,
    skippedClients: [],
    skippedPregnanciesCount: 0,
    skippedPregnancies: [],
    defaultBreastfeedCount: 0,
    defaultBreastfeedEntries: [],
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
  
  // Capture default breastfeed count
  results.defaultBreastfeedCount = filterCareAfter.defaultBreastfeedCount || 0;
  results.defaultBreastfeedEntries = filterCareAfter.defaultBreastfeedEntries || [];
  
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
    `Default Breastfeed Type Used: ${results.defaultBreastfeedCount} times`,
    '',
  ];
  
  if (results.defaultBreastfeedEntries && results.defaultBreastfeedEntries.length > 0) {
    lines.push('-'.repeat(60));
    lines.push('PREGNANCIES WITH DEFAULT BREASTFEED TYPE');
    lines.push('-'.repeat(60));
    for (const entry of results.defaultBreastfeedEntries) {
      lines.push(`  Pregnancy ID: ${entry.pregnancyId}, Care After ID: ${entry.careAfterId}`);
    }
    lines.push('');
  }
  
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
    console.log('Usage: node filter.js <input.json|input_folder/> <output.json>');
    console.log('');
    console.log('This script filters pregnancy data to keep only statistical fields.');
    console.log('Input can be either:');
    console.log('  - A single JSON file');
    console.log('  - A directory containing multiple JSON files (will be combined)');
    console.log('');
    console.log('A results.txt file will be generated alongside the output file.');
    process.exit(1);
  }
  
  const inputPath = path.resolve(args[0]);
  const outputPath = path.resolve(args[1]);
  const resultsPath = path.join(path.dirname(outputPath), 'results.txt');
  
  // Check if input is a file or directory
  let inputData = [];
  let stats;
  
  try {
    stats = fs.statSync(inputPath);
  } catch (err) {
    console.error(`Error accessing input path: ${err.message}`);
    process.exit(1);
  }
  
  if (stats.isDirectory()) {
    // Read all .json files from directory
    console.log(`Reading JSON files from directory: ${inputPath}`);
    try {
      const files = fs.readdirSync(inputPath);
      const jsonFiles = files.filter(file => file.endsWith('.json'));
      
      if (jsonFiles.length === 0) {
        console.error('No JSON files found in the directory');
        process.exit(1);
      }
      
      console.log(`Found ${jsonFiles.length} JSON file(s)`);
      
      for (const file of jsonFiles) {
        const filePath = path.join(inputPath, file);
        console.log(`  Reading: ${file}`);
        try {
          const rawData = fs.readFileSync(filePath, 'utf8');
          const fileData = JSON.parse(rawData);
          
          // Ensure fileData is an array and append to inputData
          if (Array.isArray(fileData)) {
            inputData = inputData.concat(fileData);
          } else {
            console.warn(`  Warning: ${file} does not contain an array, skipping`);
          }
        } catch (err) {
          console.error(`  Error reading ${file}: ${err.message}`);
        }
      }
      
      console.log(`Combined ${inputData.length} total clients from all files`);
      
    } catch (err) {
      console.error(`Error reading directory: ${err.message}`);
      process.exit(1);
    }
  } else if (stats.isFile()) {
    // Read single input file
    console.log(`Reading input file: ${inputPath}`);
    try {
      const rawData = fs.readFileSync(inputPath, 'utf8');
      inputData = JSON.parse(rawData);
    } catch (err) {
      console.error(`Error reading input file: ${err.message}`);
      process.exit(1);
    }
  } else {
    console.error('Input path must be a file or directory');
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
  console.log(`  Default breastfeed type used: ${results.defaultBreastfeedCount} times`);
}

main();
