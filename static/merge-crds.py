#!/usr/bin/env python3
from ruamel.yaml import YAML
import sys

yaml = YAML()
yaml.indent(mapping=2, sequence=4, offset=2)

def merge_versions(old_versions, new_versions):
  version_map = {v['name']: v for v in old_versions}
  for v in new_versions:
    name = v['name']
    if name in version_map:
      version_map[name].update(v)
    else:
      version_map[name] = v
  return sorted(version_map.values(), key=lambda x: x['name'])

def merge_crds(old_crds, new_crds):
  crd_map = {crd['name']: crd for crd in old_crds}
  for crd in new_crds:
    name = crd['name']
    if name in crd_map:
      # Merge top-level fields except 'versions'
      crd_map[name].update({k: v for k, v in crd.items() if k != 'versions'})
      # Merge versions list
      crd_map[name]['versions'] = merge_versions(crd_map[name].get('versions', []), crd.get('versions', []))
    else:
      crd_map[name] = crd
  return sorted(crd_map.values(), key=lambda x: x['name'])

def merge_yaml_files(filenames):
  merged = {}
  for filename in filenames:
    with open(filename) as f:
      data = yaml.load(f) or {}
    for group, crds in data.items():
      if group in merged:
        merged[group] = merge_crds(merged[group], crds)
      else:
        merged[group] = crds
  return merged

if __name__ == "__main__":
  if len(sys.argv) < 2:
    print(f"Usage: {sys.argv[0]} file1.yaml [file2.yaml ...]")
    sys.exit(1)

  merged_data = merge_yaml_files(sys.argv[1:])
  yaml.dump(merged_data, sys.stdout)
