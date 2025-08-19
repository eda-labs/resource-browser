#!/bin/bash

SCRIPT_DIR="$(realpath "$(dirname "${BASH_SOURCE[0]}")")"

# Output directory
output_dir="${SCRIPT_DIR}/resources"

# Source directory where the resources.yaml metadata file is located
# it drives the menu on the home page.
src_lib_dir="${SCRIPT_DIR}/../src/lib"

# Cleanup existing directory
if [ -d "$output_dir" ]; then
  echo "Cleaning up existing '$output_dir/' directory..."
  rm -rf "$output_dir"
fi

mkdir -p "$output_dir"

# YAML dictionary for CRD versions + group + kind
crd_meta_file="$src_lib_dir/resources.yaml"
> "$crd_meta_file"

# Function to process a single CRD
process_crd() {
  local crd_name="$1"
  local output_dir="$2"
  local temp_meta_file="$3"
  
  echo "Processing $crd_name"
  
  crd_dir="$output_dir/$crd_name"
  mkdir -p "$crd_dir"
  
  # Save full CRD YAML
  kubectl get crd "$crd_name" -o yaml > "$crd_dir/resource.yaml"
  
  # Extract group, kind, and versions
  group=$(kubectl get crd "$crd_name" -o jsonpath='{.spec.group}')
  kind=$(kubectl get crd "$crd_name" -o jsonpath='{.spec.names.kind}')
  versions=$(kubectl get crd "$crd_name" -o jsonpath='{.spec.versions[*].name}')
  
  # Write formatted YAML block to temp file
  {
    echo "$crd_name:"
    echo "  group: $group"
    echo "  kind: $kind"
    echo "  versions:"
    for version in $versions; do
      echo "    - $version"
    done
  } > "$temp_meta_file"
}

# Create temp directory for metadata files
temp_dir=$(mktemp -d)
trap "rm -rf $temp_dir" EXIT

# Get all CRD names and process them concurrently
crd_names=()
while IFS= read -r crd_name; do
  # populate list with EDA CRDs
  if [[ "$crd_name" == *".eda.nokia.com"* ]]; then
    crd_names+=("$crd_name")
  else
    echo "Skipping $crd_name"
  fi
done < <(kubectl get crds -o custom-columns=NAME:.metadata.name --no-headers)

# Process CRDs in parallel
pids=()
for crd_name in "${crd_names[@]}"; do
  temp_meta_file="$temp_dir/$crd_name.yaml"
  process_crd "$crd_name" "$output_dir" "$temp_meta_file" &
  pids+=($!)
done

# Wait for all background jobs to complete
echo "Waiting for all CRDs to be processed..."
for pid in "${pids[@]}"; do
  wait "$pid"
done

# Combine all metadata files in sorted order
for crd_name in $(printf '%s\n' "${crd_names[@]}" | sort); do
  temp_meta_file="$temp_dir/$crd_name.yaml"
  if [[ -f "$temp_meta_file" ]]; then
    cat "$temp_meta_file" >> "$crd_meta_file"
  fi
done

echo
echo "CRDs saved in $output_dir"
echo "CRD metadata written to $(realpath $crd_meta_file)"
