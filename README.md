# Pregnancy Data Processing Pipeline

Transform raw pregnancy healthcare data into analysis-ready CSV format through automated filtering, validation, and value mapping.

## Quick Start

### Option 1: One-Command Pipeline (Recommended)

1. Put your raw JSON files in a folder (e.g., `raw_data/`)
2. Run the pipeline:

```bash
node generate_csv_from_raw_data.js raw_data/
```

3. Find all results in the `output/` folder:
   - `final.csv` - Your analysis-ready data
   - `filtered.json` - Validated data (intermediate)
   - `mapped.json` - Value-mapped data (intermediate)
   - `filter-report.txt` - Validation statistics
   - `mapping-report.txt` - Mapping statistics

### Option 2: Step-by-Step Execution

Run each script individually for more control:

```bash
# Step 1: Filter and validate
node filter.js raw_data/ output/filtered.json

# Step 2: Map values to numbers
node map_values.js output/filtered.json mapping_rules.json output/mapped.json

# Step 3: Export to CSV
node json_to_csv.js output/mapped.json output/final.csv
```

Reports are saved alongside outputs: `filter-report.txt` and `mapping-report.txt`

## What Each Script Does

### generate_csv_from_raw_data.js (Orchestrator)
- **Input:** Folder with raw JSON files
- **Output:** `output/` folder with all results
- **Actions:** Runs all three scripts automatically, organizes outputs

### filter.js
- **Input:** Raw pregnancy JSON data (file or folder)
- **Output:** `filtered.json`, `filter-report.txt`
- **Actions:** Validates pregnancies, removes invalid data, flattens nested structures, calculates time metrics

### map_values.js
- **Input:** Filtered JSON + `mapping_rules.json`
- **Output:** `mapped.json`, `mapping-report.txt`
- **Actions:** Converts text values to numeric codes (e.g., "spontan" → 1, "sectio" → 11)

### json_to_csv.js
- **Input:** Mapped JSON
- **Output:** `final.csv`
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

### filter-report.txt
Shows what was filtered out and why:
- Skipped clients/pregnancies
- Validation failures
- Default value usage

### mapping-report.txt
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
→ Check `filter-report.txt` - pregnancy missing required fields (birth, cares_after, cares_after_phone)

**High default value usage**
→ Check `mapping-report.txt` - add missing values to `mapping_rules.json`

**Values not in CSV**
→ Edit `CSV_COLUMNS` array in `json_to_csv.js`

## Requirements

- Node.js v12 or higher
- Input data matching `example.json` schema

## Repository Structure

After cloning and running the pipeline:

```bash
git clone <repository-url>
cd rose                                        # Navigate into the repository
node generate_csv_from_raw_data.js raw_data/  # Run from here
```

Your directory structure:

```
rose/                        # Repository root (you are here)
├── generate_csv_from_raw_data.js  # One-command orchestrator
├── filter.js                # Stage 1: Filter & validate
├── map_values.js            # Stage 2: Map values
├── json_to_csv.js           # Stage 3: Export CSV
├── mapping_rules.json       # Value mapping configuration
├── README.md                # This file
├── raw_data/                # Put your input files here
│   ├── file1.json
│   ├── file2.json
│   └── ...
└── output/                  # generate_csv_from_raw_data.js creates this
    ├── final.csv            # ← Your analysis-ready data
    ├── filtered.json        # Intermediate: validated data
    ├── mapped.json          # Intermediate: mapped data
    ├── filter-report.txt    # Validation statistics
    └── mapping-report.txt   # Mapping statistics
```

