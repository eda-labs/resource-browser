#!/bin/bash
# Generate manifest.json files for each release folder
# This script scans each release folder and creates a manifest of available CRDs

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESOURCES_DIR="$SCRIPT_DIR/resources"

echo "Generating manifests for EDA releases..."

# Use Python to generate manifests
generate_all_manifests() {
    python3 << 'PYTHON_SCRIPT'
import os
import json
import yaml
from pathlib import Path

# Load the master resources.yaml for metadata
resources_yaml_path = Path("../src/lib/resources.yaml")
with open(resources_yaml_path, 'r') as f:
    resources_metadata = yaml.safe_load(f)

# Build a lookup dict for CRD metadata
crd_lookup = {}
for group, crds in resources_metadata.items():
    for crd in crds:
        crd_lookup[crd['name']] = crd

resources_dir = Path("resources")

for release_dir in sorted(resources_dir.iterdir()):
    if not release_dir.is_dir():
        continue
    
    release_name = release_dir.name
    print(f"Processing release: {release_name}")
    
    manifest = []
    count = 0
    
    for crd_dir in sorted(release_dir.iterdir()):
        if not crd_dir.is_dir():
            continue
        
        crd_name = crd_dir.name
        
        # Get metadata from resources.yaml if available
        crd_meta = crd_lookup.get(crd_name, {})
        group = crd_meta.get('group', ".".join(crd_name.split(".")[1:]))
        kind = crd_meta.get('kind', '')
        
        # List all versions that actually exist in this release
        versions = []
        yaml_files = sorted(crd_dir.glob("*.yaml"))
        
        for yaml_file in yaml_files:
            version_name = yaml_file.stem
            version_obj = {"name": version_name}
            
            # Prefer per-release YAML flag for "deprecated" if present
            try:
                with open(yaml_file, 'r') as yf:
                    parsed = yaml.safe_load(yf)
                    if isinstance(parsed, dict) and parsed.get('deprecated', False):
                        version_obj['deprecated'] = True
            except Exception:
                # If YAML parsing fails, we'll fall back to the global metadata below
                pass

            # Fall back to appVersion from resources.yaml metadata if not present in YAML
            if 'appVersion' not in version_obj and crd_meta and 'versions' in crd_meta:
                for meta_version in crd_meta['versions']:
                    if meta_version.get('name') == version_name:
                        if 'appVersion' in meta_version:
                            version_obj['appVersion'] = meta_version['appVersion']
                        break
            
            versions.append(version_obj)
            count += 1
        
        crd_obj = {
            "name": crd_name,
            "group": group,
            "kind": kind,
            "versions": versions
        }
        manifest.append(crd_obj)
    
    # Write manifest
    manifest_path = release_dir / "manifest.json"
    with open(manifest_path, 'w') as f:
        json.dump(manifest, f, indent=2)
    
    print(f"  ✓ Generated {manifest_path} ({count} version files, {len(manifest)} CRDs)")

print("\n✓ All manifests generated successfully!")
PYTHON_SCRIPT
}

# Main execution
if [ ! -d "$RESOURCES_DIR" ]; then
    echo "Error: Resources directory not found: $RESOURCES_DIR"
    exit 1
fi

# Check if python3 and pyyaml are available
if ! command -v python3 &> /dev/null; then
    echo "Error: python3 is required but not installed"
    exit 1
fi

if ! python3 -c "import yaml" 2>/dev/null; then
    echo "Error: PyYAML is required. Install with: pip3 install pyyaml"
    exit 1
fi

# Generate all manifests
cd "$SCRIPT_DIR"
generate_all_manifests

echo ""
echo "Manifest files created:"
find "$RESOURCES_DIR" -name "manifest.json" -type f
