# Pregnancy Data Processing Pipeline

Transform raw pregnancy healthcare data into analysis-ready CSV format through automated filtering, validation, and value mapping.

## Quick Start

### 3-Step Pipeline

Run these commands from your data directory (one level above the `rose/` folder):

```bash
# Step 1: Filter and validate data
node rose/filter.js input.json output.json

# Step 2: Map string values to numbers
node rose/map_values.js output.json mapping_rules.json output_mapped.json

# Step 3: Export to CSV
node rose/json_to_csv.js output_mapped.json output.csv
```

### Process Multiple Files

```bash
# Combine all JSON files from a directory
node rose/filter.js input_folder/ output.json
node rose/map_values.js output.json mapping_rules.json output_mapped.json
node rose/json_to_csv.js output_mapped.json output.csv
```

## What Each Script Does

### filter.js
- **Input:** Raw pregnancy JSON data (file or folder)
- **Output:** `output.json`, `results.txt`
- **Actions:** Validates pregnancies, removes invalid data, flattens nested structures, calculates time metrics

### map_values.js
- **Input:** Filtered JSON + `mapping_rules.json`
- **Output:** `output_mapped.json`, `results-mapping.txt`
- **Actions:** Converts text values to numeric codes (e.g., "spontan" → 1, "sectio" → 11)

### json_to_csv.js
- **Input:** Mapped JSON
- **Output:** `output.csv`
- **Actions:** Flattens data into table format (one row per care visit)

## Extending Value Mappings

Edit `mapping_rules.json` to add new value mappings:

```json
{
  "property_name": {
    "text_value_1": 1,
    "text_value_2": 2,
    "text_value_3": 3,
    "default": -1
  }
}
```

Changes take effect immediately on next run.

## Understanding the Reports

### results.txt
Shows what was filtered out and why:
- Skipped clients/pregnancies
- Validation failures
- Default value usage

### results-mapping.txt
Shows mapping statistics:
- How many values were mapped
- Which values had no mapping (used defaults)
- Success rate per property

## CSV Output Structure

Each row = one care visit (in-person or phone call)

| Column | Description |
|--------|-------------|
| client_id, pregnancy_id | Identifiers |
| grav, para | Numeric values |
| birth_mode, blood_loss | Mapped to numbers (1-19) |
| is_home_visit | 1 = in-person, 0 = phone |
| date_start, date_end | Visit times |
| duration_of_visit | Minutes |
| age_of_child | Hours since birth |
| time_since_discharge | Hours since discharge |
| breastfeed_type | Mapped 0-4 |
| baby_food | Mapped 0-2 |

## Common Issues

**"No valid pregnancies remaining"**
→ Check `results.txt` - pregnancy missing required fields (birth, cares_after, cares_after_phone)

**High default value usage**
→ Check `results-mapping.txt` - add missing values to `mapping_rules.json`

**Values not in CSV**
→ Edit `CSV_COLUMNS` array in `json_to_csv.js`

## Requirements

- Node.js v12 or higher
- Input data matching `example.json` schema

