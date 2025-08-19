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

# Process each CRD
kubectl get crds -o custom-columns=NAME:.metadata.name --no-headers | while read -r crd_name; do
  # skip non .eda.nokia.com CRDs
  if [[ "$crd_name" != *".eda.nokia.com"* ]]; then
    echo "Skipping $crd_name"
    continue
  fi

  echo "Processing $crd_name"

  crd_dir="$output_dir/$crd_name"
  mkdir -p "$crd_dir"

  # Save full CRD YAML
  kubectl get crd "$crd_name" -o yaml > "$crd_dir/resource.yaml"

  # Extract group, kind, and versions
  group=$(kubectl get crd "$crd_name" -o jsonpath='{.spec.group}')
  kind=$(kubectl get crd "$crd_name" -o jsonpath='{.spec.names.kind}')
  versions=$(kubectl get crd "$crd_name" -o jsonpath='{.spec.versions[*].name}')

  # Write formatted YAML block
  echo "$crd_name:" >> "$crd_meta_file"
  echo "  group: $group" >> "$crd_meta_file"
  echo "  kind: $kind" >> "$crd_meta_file"
  echo "  versions:" >> "$crd_meta_file"
  for version in $versions; do
    echo "    - $version" >> "$crd_meta_file"
  done
done

echo "CRDs saved in $output_dir/{crd}/resource.yaml"
echo "CRD metadata written to $crd_meta_file"
