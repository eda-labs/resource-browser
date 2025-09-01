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
crd_meta_tmp_file="$src_lib_dir/resources_tmp.yaml"

# Create temp directory for metadata files
temp_dir=$(mktemp -d)
trap "rm -rf $temp_dir" EXIT

# Get installed manifests
manifests_file="$src_lib_dir/manifests.yaml"
kubectl get -n eda-system manifests -o yaml > "$manifests_file"

# Function to process a single CRD
process_crd() {
  local crd_name="$1"
  local output_dir="$2"
  local temp_dir="$3"
  local manifests="$(cat $4)"

  echo "Processing $crd_name"

  crd_dir="$output_dir/$crd_name"
  mkdir -p "$crd_dir"

  # get full CRD in yaml
  crd_yaml=$(kubectl get crd "$crd_name" -o yaml)

  # metadata
  group=$(echo "$crd_yaml" | yq eval '.spec.group')
  kind=$(echo "$crd_yaml" | yq eval '.spec.names.kind')
  versions=$(echo "$crd_yaml" | yq eval '.spec.versions[].name' | xargs)

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
    deprecated=$(echo "$crd_yaml" | yq eval ".spec.versions[] | select(.name == \"$version\") | .deprecated")
    if [ -z "$deprecated" ] || [ "$deprecated" == "null" ]; then
      deprecated=false
    fi

    # 4 spaces for version list
    echo "    - name: $version" >> "$tmp_file"
    echo "      deprecated: $deprecated" >> "$tmp_file"

    appVersion=$(echo "$manifests" | yq eval ".items[] | select(.metadata.name == \"$group\" and .spec.version == \"$version\") | .metadata.annotations.[\"appstore.eda.nokia.com/version-value\"]")
    if [ -n "$appVersion" ]; then
      echo "      appVersion: $appVersion" >> "$tmp_file"
    fi

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
    echo "Skipping $crd_name"
  fi
done < <(kubectl get crds -o custom-columns=NAME:.metadata.name --no-headers)

# parallel CRD processing
echo
export -f process_crd
printf "%s\n" "${crd_names[@]}" \
  | xargs -P64 -I{} bash -c 'process_crd "$1" "$2" "$3" "$4"' _ {} "$output_dir" "$temp_dir" "$manifests_file"

rm -rf "$manifests_file"

# Filter out files ending with 'states.eda.nokia.com.yaml' and cat only the non-states files
find "$temp_dir" -name "*.yaml" -not -name "*states.*.eda.nokia.com.yaml" -exec cat {} \; \
  | yq eval 'group_by(.group) | map({(.[0].group): (. | sort_by(.name))}) | .[] as $first | $first' > "$crd_meta_tmp_file"

# Sort the top-level groups alphabetically
yq eval 'to_entries | sort_by(.key) | from_entries' -i "$crd_meta_tmp_file"

# Merging new CRD metadata into existing (if necessary)
if [ -f "$crd_meta_file" ]; then
  echo
  echo "Merging meta file with new information..."
  python3 merge-crds.py "$crd_meta_file" "$crd_meta_tmp_file" > "$crd_meta_file.tmp" \
    && mv "$crd_meta_file.tmp" "$crd_meta_file"
  rm -rf "$crd_meta_tmp_file"
else
  mv "$crd_meta_tmp_file" "$crd_meta_file"
fi

echo
echo "CRDs saved in $output_dir"
echo "CRD metadata written to $(realpath $crd_meta_file)"
