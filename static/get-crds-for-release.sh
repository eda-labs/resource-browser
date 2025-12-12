#!/bin/bash

# Usage: ./get-crds-for-release.sh <release-folder-name>
# Example: ./get-crds-for-release.sh 25.4.2

RELEASE="${1:-25.4.2}"
SCRIPT_DIR="$(realpath "$(dirname "${BASH_SOURCE[0]}")")"

# Output directory for this specific release
output_dir="${SCRIPT_DIR}/resources/${RELEASE}"

# Source directory where the resources.yaml metadata file is located
src_lib_dir="${SCRIPT_DIR}/../src/lib"

echo "Extracting CRDs for release: ${RELEASE}"
echo "Output directory: ${output_dir}"
echo ""
echo "⚠️  IMPORTANT: Make sure kubectl is connected to the ${RELEASE} cluster!"
echo ""
read -p "Press Enter to continue or Ctrl+C to cancel..."

# Cleanup existing release directory
if [ -d "$output_dir" ]; then
  echo "Cleaning up existing '$output_dir/' directory..."
  rm -rf "$output_dir"
fi

mkdir -p "$output_dir"

uv --project ${SCRIPT_DIR} sync --all-groups

# YAML dictionary for CRD versions + group + kind
crd_meta_file="$src_lib_dir/resources.yaml"

# Create temp directory for metadata files
temp_dir=$(mktemp -d)
trap "rm -rf $temp_dir" EXIT

# Get installed manifests
manifests_file=$(mktemp)
trap "rm -f $manifests_file" EXIT
kubectl get -n eda-system manifests -o yaml > "$manifests_file" 2>/dev/null || echo "Warning: Could not fetch manifests from eda-system namespace"

# Function to process a single CRD
process_crd() {
  local crd_name="$1"
  local output_dir="$2"
  local temp_dir="$3"
  local manifests="$(cat $4 2>/dev/null || echo '')"

  echo "Processing $crd_name"

  crd_dir="$output_dir/$crd_name"
  mkdir -p "$crd_dir"

  # get full CRD in yaml
  crd_yaml=$(kubectl get crd "$crd_name" -o yaml)

  # metadata
  group=$(echo "$crd_yaml" | yq eval '.spec.group')
  kind=$(echo "$crd_yaml" | yq eval '.spec.names.kind')
  versions=$(echo "$crd_yaml" | yq eval '.spec.versions[].name' | xargs)

  # per-version loop
  for version in $versions; do
    # extract only this version block
    echo "$crd_yaml" \
      | yq eval ".spec.versions[] | select(.name == \"$version\")" \
      | yq eval -P > "$crd_dir/$version.yaml"
  done
}

# Get all CRD names and process them concurrently
crd_names=()
while IFS= read -r crd_name; do
  # populate list with EDA CRDs
  if [[ "$crd_name" == *".eda.nokia.com"* ]]; then
    crd_names+=("$crd_name")
  else
    echo "Skipping non-EDA CRD: $crd_name"
  fi
done < <(kubectl get crds -o custom-columns=NAME:.metadata.name --no-headers)

echo ""
echo "Found ${#crd_names[@]} EDA CRDs to extract"
echo ""

# parallel CRD processing
export -f process_crd
printf "%s\n" "${crd_names[@]}" \
  | xargs -P64 -I{} bash -c 'process_crd "$1" "$2" "$3" "$4"' _ {} "$output_dir" "$temp_dir" "$manifests_file"

echo ""
echo "✅ CRDs saved in $output_dir"
echo ""
echo "Next steps:"
echo "1. Run: cd $SCRIPT_DIR && ./generate-manifests.sh"
echo "2. This will regenerate manifest.json for release ${RELEASE}"

