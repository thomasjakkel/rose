#!/usr/bin/env node

/**
 * Value Mapping Script for Pregnancy Data
 * 
 * Maps string values to numeric values based on configurable mapping rules.
 * Sits between filter.js and json_to_csv.js in the processing pipeline.
 * 
 * USAGE:
 *   node map_values.js <input.json> <mapping_rules.json> <output.json>
 * 
 * PIPELINE:
 *   filter.js → output.json → map_values.js → output_mapped.json → json_to_csv.js
 * 
 * OUTPUTS:
 *   - <output.json>        : Transformed dataset with numeric values
 *   - mapping-report.txt   : Processing report with mapping statistics
 * 
 * MAPPING RULES FORMAT (JSON):
 *   {
 *     "property_name": {
 *       "string_value": numeric_value,
 *       "another_value": numeric_value,
 *       "default": default_numeric_value
 *     },
 *     "_global_default": -1,
 *     "_datetime_patterns": ["date_start", "date_end", ...]
 *   }
 * 
 * FEATURES:
 *   - Configurable mapping rules via JSON file
 *   - Property-specific default values
 *   - Global default fallback
 *   - Datetime exclusion (preserves date/time strings)
 *   - Comprehensive reporting of unmapped values
 */

const fs = require('fs');
const path = require('path');

// =============================================================================
// MAPPING LOGIC
// =============================================================================

/**
 * Check if a string looks like a datetime value
 */
function isDateTimeValue(value) {
  if (typeof value !== 'string') return false;
  
  // Pattern 1: YYYY-MM-DD HH:MM:SS
  const iso = /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$/;
  // Pattern 2: DD.MM.YYYY HH:MM
  const german = /^\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2}$/;
  // Pattern 3: ISO 8601
  const isoFull = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
  
  return iso.test(value) || german.test(value) || isoFull.test(value);
}

/**
 * Map a single value based on mapping rules
 */
function mapValue(propertyName, value, mappingRules, stats, excludeDatetimes) {
  // Skip null/undefined
  if (value === null || value === undefined) {
    return value;
  }
  
  // Convert boolean values to strings for mapping lookup
  let lookupValue = value;
  if (typeof value === 'boolean') {
    lookupValue = String(value);
  }
  
  // Skip non-string and non-boolean values
  if (typeof value !== 'string' && typeof value !== 'boolean') {
    return value;
  }
  
  // Skip datetime values if property is in exclusion list
  if (typeof lookupValue === 'string' && (excludeDatetimes.includes(propertyName) || isDateTimeValue(lookupValue))) {
    return value;
  }
  
  // Initialize stats for this property if not exists
  if (!stats.propertiesMapped[propertyName]) {
    stats.propertiesMapped[propertyName] = {
      total: 0,
      mapped: 0,
      usedDefault: 0,
      unmappedValues: {}
    };
  }
  
  stats.propertiesMapped[propertyName].total++;
  
  // Check if there's a mapping rule for this property
  if (mappingRules[propertyName]) {
    const propertyMapping = mappingRules[propertyName];
    
    // Check if value has a specific mapping (use string version for lookup)
    if (lookupValue in propertyMapping && propertyMapping[lookupValue] !== undefined && propertyMapping[lookupValue] !== 'default') {
      stats.propertiesMapped[propertyName].mapped++;
      return propertyMapping[lookupValue];
    }
    
    // Use property-specific default if available
    if ('default' in propertyMapping) {
      stats.propertiesMapped[propertyName].usedDefault++;
      
      // Track unmapped value (use string version for display)
      if (!stats.propertiesMapped[propertyName].unmappedValues[lookupValue]) {
        stats.propertiesMapped[propertyName].unmappedValues[lookupValue] = 0;
      }
      stats.propertiesMapped[propertyName].unmappedValues[lookupValue]++;
      
      return propertyMapping.default;
    }
  }
  
  // Use global default
  const globalDefault = mappingRules._global_default !== undefined ? mappingRules._global_default : -1;
  stats.propertiesMapped[propertyName].usedDefault++;
  
  // Track unmapped value (use string version for display)
  if (!stats.propertiesMapped[propertyName].unmappedValues[lookupValue]) {
    stats.propertiesMapped[propertyName].unmappedValues[lookupValue] = 0;
  }
  stats.propertiesMapped[propertyName].unmappedValues[lookupValue]++;
  
  return globalDefault;
}

/**
 * Recursively process an object and map string and boolean values
 */
function processObject(obj, mappingRules, stats, excludeDatetimes, currentPath = '') {
  if (obj === null || obj === undefined) {
    return obj;
  }
  
  if (Array.isArray(obj)) {
    return obj.map((item, index) => 
      processObject(item, mappingRules, stats, excludeDatetimes, `${currentPath}[${index}]`)
    );
  }
  
  if (typeof obj === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      const newPath = currentPath ? `${currentPath}.${key}` : key;
      
      if (typeof value === 'string' || typeof value === 'boolean') {
        result[key] = mapValue(key, value, mappingRules, stats, excludeDatetimes);
      } else if (typeof value === 'object' && value !== null) {
        result[key] = processObject(value, mappingRules, stats, excludeDatetimes, newPath);
      } else {
        result[key] = value;
      }
    }
    return result;
  }
  
  return obj;
}

/**
 * Process entire dataset
 */
function processData(inputData, mappingRules) {
  const stats = {
    totalValuesProcessed: 0,
    totalValuesMapped: 0,
    totalDefaultsUsed: 0,
    propertiesMapped: {}
  };
  
  // Get datetime exclusion patterns
  const excludeDatetimes = mappingRules._datetime_patterns || [];
  
  // Process the data
  const outputData = processObject(inputData, mappingRules, stats, excludeDatetimes);
  
  // Calculate totals
  for (const propStats of Object.values(stats.propertiesMapped)) {
    stats.totalValuesProcessed += propStats.total;
    stats.totalValuesMapped += propStats.mapped;
    stats.totalDefaultsUsed += propStats.usedDefault;
  }
  
  return { outputData, stats };
}

// =============================================================================
// REPORTING
// =============================================================================

function generateMappingReport(stats, mappingRulesPath) {
  const lines = [
    '='.repeat(70),
    'VALUE MAPPING RESULTS REPORT',
    '='.repeat(70),
    '',
    `Run Date: ${new Date().toISOString()}`,
    `Mapping Rules: ${path.basename(mappingRulesPath)}`,
    '',
    '-'.repeat(70),
    'SUMMARY',
    '-'.repeat(70),
    `Total String Values Processed: ${stats.totalValuesProcessed}`,
    `Successfully Mapped: ${stats.totalValuesMapped}`,
    `Used Default Values: ${stats.totalDefaultsUsed}`,
    `Mapping Success Rate: ${stats.totalValuesProcessed > 0 ? 
      ((stats.totalValuesMapped / stats.totalValuesProcessed) * 100).toFixed(2) : 0}%`,
    '',
  ];
  
  // Sort properties by number of defaults used (descending)
  const sortedProperties = Object.entries(stats.propertiesMapped)
    .sort((a, b) => b[1].usedDefault - a[1].usedDefault);
  
  if (sortedProperties.length > 0) {
    lines.push('-'.repeat(70));
    lines.push('PROPERTY-LEVEL STATISTICS');
    lines.push('-'.repeat(70));
    lines.push('');
    
    for (const [property, propStats] of sortedProperties) {
      const mappingRate = propStats.total > 0 ? 
        ((propStats.mapped / propStats.total) * 100).toFixed(1) : 0;
      
      lines.push(`Property: ${property}`);
      lines.push(`  Total values: ${propStats.total}`);
      lines.push(`  Mapped: ${propStats.mapped} (${mappingRate}%)`);
      lines.push(`  Used default: ${propStats.usedDefault}`);
      
      // Show unmapped values if any
      const unmappedEntries = Object.entries(propStats.unmappedValues);
      if (unmappedEntries.length > 0) {
        lines.push(`  Unmapped values:`);
        for (const [value, count] of unmappedEntries) {
          lines.push(`    "${value}" (${count} occurrence${count > 1 ? 's' : ''})`);
        }
      }
      lines.push('');
    }
  }
  
  // Section for properties that used defaults
  const propertiesWithDefaults = sortedProperties.filter(([, stats]) => stats.usedDefault > 0);
  
  if (propertiesWithDefaults.length > 0) {
    lines.push('-'.repeat(70));
    lines.push('PROPERTIES WITH DEFAULT VALUES USED');
    lines.push('-'.repeat(70));
    
    for (const [property, propStats] of propertiesWithDefaults) {
      const percentage = ((propStats.usedDefault / propStats.total) * 100).toFixed(1);
      lines.push(`  ${property}: ${propStats.usedDefault}/${propStats.total} (${percentage}%)`);
    }
    lines.push('');
  }
  
  lines.push('='.repeat(70));
  lines.push('END OF REPORT');
  lines.push('='.repeat(70));
  
  return lines.join('\n');
}

// =============================================================================
// CLI ENTRY POINT
// =============================================================================

function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 3) {
    console.log('Usage: node map_values.js <input.json> <mapping_rules.json> <output.json>');
    console.log('');
    console.log('Maps string values to numeric values based on configurable rules.');
    console.log('Generates mapping-report.txt with detailed statistics.');
    process.exit(1);
  }
  
  const inputPath = path.resolve(args[0]);
  const mappingRulesPath = path.resolve(args[1]);
  const outputPath = path.resolve(args[2]);
  const reportPath = path.join(path.dirname(outputPath), 'mapping-report.txt');
  
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
  
  // Read mapping rules
  console.log(`Reading mapping rules: ${mappingRulesPath}`);
  let mappingRules;
  try {
    const rawRules = fs.readFileSync(mappingRulesPath, 'utf8');
    mappingRules = JSON.parse(rawRules);
  } catch (err) {
    console.error(`Error reading mapping rules: ${err.message}`);
    process.exit(1);
  }
  
  // Validate input
  if (!Array.isArray(inputData)) {
    console.error('Error: Input JSON must be an array');
    process.exit(1);
  }
  
  // Process data
  console.log('Mapping values...');
  const { outputData, stats } = processData(inputData, mappingRules);
  
  // Write output JSON
  console.log(`Writing output file: ${outputPath}`);
  try {
    fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2), 'utf8');
  } catch (err) {
    console.error(`Error writing output file: ${err.message}`);
    process.exit(1);
  }
  
  // Write mapping report
  console.log(`Writing mapping report: ${reportPath}`);
  try {
    const report = generateMappingReport(stats, mappingRulesPath);
    fs.writeFileSync(reportPath, report, 'utf8');
  } catch (err) {
    console.error(`Error writing report file: ${err.message}`);
    process.exit(1);
  }
  
  // Print summary to console
  console.log('');
  console.log('Mapping complete!');
  console.log(`  Values processed: ${stats.totalValuesProcessed}`);
  console.log(`  Successfully mapped: ${stats.totalValuesMapped}`);
  console.log(`  Used defaults: ${stats.totalDefaultsUsed}`);
  console.log(`  Properties mapped: ${Object.keys(stats.propertiesMapped).length}`);
}

main();
