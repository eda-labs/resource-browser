#!/bin/bash

# Create a base output directory (optional)
output_dir="resources"
mkdir -p "$output_dir"

# Get all CRD names
kubectl get crds -o custom-columns=NAME:.metadata.name --no-headers | while read -r crd_name; do
  echo "Exporting CRD: $crd_name"

  # Create a directory for the CRD
  crd_dir="$output_dir/$crd_name"
  mkdir -p "$crd_dir"

  # Dump CRD JSON
  kubectl get crd "$crd_name" -o json > "$crd_dir/resource.json"
done

echo "Done. All CRDs saved in ./$output_dir/"
