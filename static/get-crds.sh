#!/bin/bash

# Output directory
output_dir="resources"

# Cleanup existing directory
if [ -d "$output_dir" ]; then
  echo "Cleaning up existing '$output_dir/' directory..."
  rm -rf "$output_dir"
fi

mkdir -p "$output_dir"

# YAML dictionary for CRD versions + group + kind
yaml_dict_file="$output_dir/resources.yaml"
> "$yaml_dict_file"

# Process each CRD
kubectl get crds -o custom-columns=NAME:.metadata.name --no-headers | while read -r crd_name; do
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
  echo "$crd_name:" >> "$yaml_dict_file"
  echo "  group: $group" >> "$yaml_dict_file"
  echo "  kind: $kind" >> "$yaml_dict_file"
  echo "  versions:" >> "$yaml_dict_file"
  for version in $versions; do
    echo "    - $version" >> "$yaml_dict_file"
  done
done

echo "CRDs saved in ./$output_dir/{crd}/resource.yaml"
echo "CRD metadata written to ./$yaml_dict_file"
