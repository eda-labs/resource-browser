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

# Create temp directory for metadata files
temp_dir=$(mktemp -d)
trap "rm -rf $temp_dir" EXIT

# Function to process a single CRD
process_crd() {
  local crd_name="$1"
  local output_dir="$2"
  local temp_dir="$3"

  echo "Processing $crd_name"

  crd_dir="$output_dir/$crd_name"
  mkdir -p "$crd_dir"

  # get full CRD in yaml
  crd_yaml=$(kubectl get crd "$crd_name" -o yaml)

  # metadata
  group=$(kubectl get crd "$crd_name" -o jsonpath='{.spec.group}')
  kind=$(kubectl get crd "$crd_name" -o jsonpath='{.spec.names.kind}')
  versions=$(kubectl get crd "$crd_name" -o jsonpath='{.spec.versions[*].name}')

  # temp file for this CRD
  tmp_file="$temp_dir/$crd_name.yaml"
  > "$tmp_file"

  # add CRD entry (2 spaces indent under group)
  echo "- name: $crd_name" >> "$tmp_file"
  echo "  group: $group" >> "$tmp_file"
  echo "  kind: $kind" >> "$tmp_file"
  echo "  versions:" >> "$tmp_file"

  # per-version loop
  for version in $versions; do
    deprecated=$(kubectl get crd "$crd_name" \
      -o jsonpath="{.spec.versions[?(@.name==\"$version\")].deprecated}")
    if [ -z "$deprecated" ]; then
      deprecated=false
    fi

    # 4 spaces for version list
    echo "    - name: $version" >> "$tmp_file"
    echo "      deprecated: $deprecated" >> "$tmp_file"

    # extract only this version block
    kubectl get crd "$crd_name" -o jsonpath="{.spec.versions[?(@.name==\"$version\")]}" \
      | yq eval -P > "$crd_dir/$version.yaml"
  done
}

# parallel CRD processing (adjust -P4 for concurrency)
export -f process_crd
kubectl get crds -o custom-columns=NAME:.metadata.name --no-headers \
  | xargs -P4 -I{} bash -c 'process_crd "$1" "$2" "$3"' _ {} "$output_dir" "$temp_dir"

cat "$temp_dir"/*.yaml \
  | yq eval 'group_by(.group) | map({(.[0].group): .}) | .[] as $first | $first' - > "$crd_meta_file"

rm -rf "$temp_dir"

echo
echo "CRDs saved in $output_dir"
echo "CRD metadata written to $(realpath $crd_meta_file)"
