# Pregnancy Data Processing Pipeline

A comprehensive data processing pipeline for filtering, mapping, and transforming pregnancy healthcare data into analysis-ready formats.

## Overview

This toolkit processes large pregnancy datasets through a three-stage pipeline:

1. **Filter & Flatten** - Extracts relevant statistical fields, removes sensitive data, validates pregnancies
2. **Value Mapping** - Converts string values to numeric codes using configurable rules
3. **CSV Export** - Flattens nested JSON into tabular CSV format for analysis

## Quick Start

### Prerequisites

- Node.js (v12 or higher)
- Input data following the schema in `example.json`

### Basic Usage

```bash
# Step 1: Filter and flatten raw data
node filter.js <input.json|input_folder/> output.json

# Step 2: Map string values to numeric codes
node map_values.js output.json ../mapping_rules.json output_mapped.json

# Step 3: Convert to CSV
node json_to_csv.js output_mapped.json output.csv
```

### Example

```bash
# Process a single file
node filter.js ../example.json ../output.json
node map_values.js ../output.json ../mapping_rules.json ../output_mapped.json
node json_to_csv.js ../output_mapped.json ../output.csv

# Process multiple files from a directory
node filter.js ../data_folder/ ../output.json
node map_values.js ../output.json ../mapping_rules.json ../output_mapped.json
node json_to_csv.js ../output_mapped.json ../output.csv
```

## Scripts Reference

### 1. filter.js - Data Filtering & Flattening

**Purpose:** Extracts statistical fields, validates data, flattens nested structures

**Input:** Raw pregnancy data JSON (single file or directory of JSON files)

**Outputs:**
- `output.json` - Filtered and flattened data
- `results.txt` - Processing report with validation statistics

**Key Features:**
- Pregnancy-level validation (skips invalid pregnancies, keeps valid ones)
- Single-child enforcement per pregnancy
- Flattens nested `data_encr`, `birth`, and `children` objects
- Property renaming (e.g., `geburts-modus` → `birth_mode`)
- Calculated fields: `duration_of_visit`, `age_of_child`, `time_since_discharge`
- Date format standardization (German → ISO format)
- Breastfeeding type consolidation
- Directory support (combines multiple JSON files)

**Configuration:**

Edit `CONFIG` object in `filter.js`:

```javascript
const CONFIG = {
  required: {
    client: ['pregnancies'],
    pregnancy: ['birth', 'cares_after', 'cares_after_phone'],
    birth: ['children']
  },
  whitelist: {
    client: ['id', 'pregnancies'],
    pregnancy: ['id', 'cares_after', 'cares_after_phone'],
    // ... add/remove properties as needed
  },
  flatten: {
    pregnancyDataEncr: ['grav', 'para'],
    birthDataEncr: {
      'geburts-modus': 'birth_mode',
      // ... add new mappings
    }
  }
};
```

**Validation Rules:**
- Client must have non-empty `pregnancies` array
- Each pregnancy must have `birth`, `cares_after`, and `cares_after_phone` (non-empty)
- Each birth must have exactly 1 child

### 2. map_values.js - Value Mapping

**Purpose:** Converts string/boolean values to numeric codes based on configurable rules

**Input:** Filtered JSON from `filter.js`

**Outputs:**
- `output_mapped.json` - JSON with numeric values
- `results-mapping.txt` - Mapping statistics and unmapped values report

**Key Features:**
- Property-specific mappings with defaults
- Global fallback default value
- Boolean value support
- Datetime value preservation
- Detailed reporting of unmapped values
- Mapping success rate calculation

**Configuration:**

Edit `../mapping_rules.json`:

```json
{
  "property_name": {
    "string_value": numeric_code,
    "another_value": numeric_code,
    "default": fallback_code
  },
  "_global_default": -1,
  "_datetime_patterns": ["date_start", "date_end", ...]
}
```

### 3. json_to_csv.js - CSV Export

**Purpose:** Flattens nested JSON structure into tabular CSV format

**Input:** Mapped JSON from `map_values.js`

**Output:** `output.csv` - Flattened CSV with one row per care visit

**Key Features:**
- Each care visit (in-person or phone) becomes one row
- Client and pregnancy data repeated per visit
- `is_home_visit` column: 1 = in-person, 0 = phone
- Proper CSV escaping for special characters
- Empty values for type-specific fields

**CSV Structure:**

| Column | Source | Description |
|--------|--------|-------------|
| client_id | Client | Client identifier |
| pregnancy_id | Pregnancy | Pregnancy identifier |
| grav, para | Pregnancy | Gravida and para values |
| birth_mode, blood_loss | Pregnancy | Birth details |
| discharge_date, date_birth | Pregnancy | Date fields |
| is_home_visit | Derived | 1=in-person, 0=phone |
| care_id, date_start, date_end | Care | Visit details |
| duration_of_visit, age_of_child, time_since_discharge | Calculated | Time metrics (minutes/hours) |
| is_first_care, baby_food, breastfeed_type | In-person only | Home visit specific |
| is_breast_feeding | Phone only | Phone consultation specific |

## Pipeline Details

### Data Flow

```
Raw JSON Data
    ↓
[filter.js]
    ↓
output.json (flattened, validated)
results.txt (filter report)
    ↓
[map_values.js]
    ↓
output_mapped.json (numeric values)
results-mapping.txt (mapping report)
    ↓
[json_to_csv.js]
    ↓
output.csv (tabular format)
```

### Data Transformations

**Stage 1 (filter.js):**
- Validates each pregnancy individually
- Removes invalid pregnancies but keeps client if ≥1 valid pregnancy exists
- Flattens nested objects into pregnancy level
- Renames properties for clarity
- Calculates time-based metrics
- Converts date formats to ISO standard
- Consolidates breastfeeding properties into single `breastfeed_type`

**Stage 2 (map_values.js):**
- Converts categorical string values to numeric codes
- Handles boolean values (true/false → 1/0)
- Preserves datetime strings
- Uses property-specific or global defaults for unmapped values
- Tracks and reports unmapped values

**Stage 3 (json_to_csv.js):**
- Unnests cares_after and cares_after_phone arrays
- Creates one row per care visit
- Repeats client/pregnancy data for each visit
- Merges similar fields from both visit types
- Adds visit type indicator

## Extending Mappings

### Adding New String-to-Numeric Mappings

1. **Edit `../mapping_rules.json`:**

```json
{
  "your_property_name": {
    "value1": 1,
    "value2": 2,
    "value3": 3,
    "default": -1
  }
}
```

2. **Run the pipeline** - Changes take effect immediately

### Adding New Properties to Filter

1. **Edit `filter.js` CONFIG:**

```javascript
// To add to output
whitelist: {
  careAfter: ['id', 'date_start', 'date_end', 'new_property']
}

// To flatten from data_encr
flatten: {
  careAfterDataEncr: ['stillt', 'is_first_care', 'new_property']
}
```

2. **Add mapping rule** (if string value):

```json
{
  "new_property": {
    "value1": 1,
    "value2": 2,
    "default": -1
  }
}
```

3. **Update CSV columns** in `json_to_csv.js`:

```javascript
const CSV_COLUMNS = [
  // ... existing columns
  'new_property',
];
```

### Excluding Properties from Mapping

To preserve string values (e.g., IDs, codes), add to datetime patterns:

```json
{
  "_datetime_patterns": [
    "date_start",
    "date_end",
    "property_to_exclude"
  ]
}
```

## Report Files

### results.txt (from filter.js)

Shows:
- Total clients processed
- Successfully transformed clients
- Skipped clients with reasons
- Skipped pregnancies with reasons
- Default breastfeed_type usage count
- List of pregnancy/care IDs where defaults were used

### results-mapping.txt (from map_values.js)

Shows:
- Total values processed
- Successfully mapped values
- Default value usage count
- Mapping success rate
- Property-level statistics
- List of unmapped values with occurrence counts
- Properties that used default values

## Validation Rules

### Client-Level
- Must have non-empty `pregnancies` array
- Skipped only if no valid pregnancies remain

### Pregnancy-Level
- Must have `birth` object
- Must have non-empty `cares_after` array
- Must have non-empty `cares_after_phone` array
- Birth must have exactly 1 child

### Breastfeed Type Logic
- Checks for: `stillt`, `primar-abgestillt`, `abgestillt`, `stillt-teilweise`, `frau-pumpt-ab`
- Uses found value if exactly one is set
- Uses default `stillt-teilweise` if none or multiple are set
- Tracks default usage in reports

## Calculated Fields

### duration_of_visit
- Formula: `date_end - date_start`
- Unit: minutes
- Available for: both in-person and phone visits

### age_of_child
- Formula: `visit_date_start - date_birth`
- Unit: hours
- Available for: both in-person and phone visits

### time_since_discharge
- Formula: `visit_date_start - discharge_date`
- Unit: hours
- Available for: both in-person and phone visits

## Troubleshooting

### Issue: "No valid pregnancies remaining after validation"

**Cause:** All pregnancies in a client failed validation

**Solution:** Check `results.txt` for specific validation failures. Common causes:
- Missing or empty `cares_after` or `cares_after_phone` arrays
- Multiple children per pregnancy (only 1 allowed)
- Missing `birth` object

### Issue: High default value usage in mapping

**Cause:** String values in data don't match mapping rules

**Solution:** Check `results-mapping.txt` "Unmapped values" section. Add missing values to `mapping_rules.json`:

```json
{
  "property_name": {
    "unmapped_value": appropriate_numeric_code
  }
}
```

### Issue: Properties not appearing in CSV

**Cause:** Property not in CSV_COLUMNS list

**Solution:** Add to `CSV_COLUMNS` array in `json_to_csv.js`

### Issue: Date values being mapped to numbers

**Cause:** Date property not in exclusion list

**Solution:** Add to `_datetime_patterns` in `mapping_rules.json`:

```json
{
  "_datetime_patterns": [
    "date_start",
    "date_end",
    "your_date_property"
  ]
}
```

## Best Practices

1. **Always run the full pipeline** after changes to ensure consistency
2. **Back up raw data** before processing
3. **Review report files** (`results.txt`, `results-mapping.txt`) after each run
4. **Test with small datasets** when adding new mappings
5. **Use descriptive numeric codes** (not just 0,1,2) for better data interpretation
6. **Keep mapping_rules.json versioned** for reproducibility
7. **Document custom mappings** with comments in mapping_rules.json

## File Structure

```
rose/
├── README.md                 # This file
├── filter.js                 # Stage 1: Filter & flatten
├── map_values.js            # Stage 2: Value mapping
├── json_to_csv.js           # Stage 3: CSV export
│
../                          # Parent directory
├── mapping_rules.json       # Mapping configuration
├── example.json             # Sample input data
├── output.json              # Stage 1 output
├── output_mapped.json       # Stage 2 output
├── output.csv               # Final CSV output
├── results.txt              # Stage 1 report
└── results-mapping.txt      # Stage 2 report
```

## License

[Add your license information here]

## Contributors

[Add contributor information here]
