#!/usr/bin/env python3
import re
import sys

from ruamel.yaml import YAML

yaml = YAML()
yaml.indent(mapping=2, sequence=4, offset=2)


# Kubernetes-style API version ordering: v1alpha1 < v1alpha2 < v1beta1 < v1 < v2
# See https://kubernetes.io/docs/reference/using-api/#api-versioning
_ALPHA = re.compile(r"^v(\d+)alpha(\d+)$")
_BETA = re.compile(r"^v(\d+)beta(\d+)$")
_GA = re.compile(r"^v(\d+)$")


def parse_k8s_api_version(v: str) -> tuple:
    m = _GA.match(v)
    if m:
        return (int(m.group(1)), 2, 0)
    m = _ALPHA.match(v)
    if m:
        return (int(m.group(1)), 0, int(m.group(2)))
    m = _BETA.match(v)
    if m:
        return (int(m.group(1)), 1, int(m.group(2)))
    # Unknown pattern: stable sort after known forms
    return (9999, 3, v)


def sort_key_version(entry: dict) -> tuple:
    name = entry["name"]
    return (parse_k8s_api_version(name), name)


def merge_versions(old_versions, new_versions):
    version_map = {v["name"]: v for v in old_versions}
    for v in new_versions:
        name = v["name"]
        if name in version_map:
            version_map[name].update(v)
        else:
            version_map[name] = v
    merged = list(version_map.values())
    merged.sort(key=sort_key_version)
    return merged


def merge_crds(old_crds, new_crds):
    crd_map = {crd["name"]: crd for crd in old_crds}
    for crd in new_crds:
        name = crd["name"]
        if name in crd_map:
            crd_map[name].update({k: v for k, v in crd.items() if k != "versions"})
            crd_map[name]["versions"] = merge_versions(
                crd_map[name].get("versions", []), crd.get("versions", [])
            )
        else:
            crd_map[name] = crd
    return sorted(crd_map.values(), key=lambda x: x["name"])


def normalize_crd_versions(merged: dict) -> None:
    """Sort API versions for every CRD (covers paths that skipped merge_versions)."""
    for _group, crds in merged.items():
        for crd in crds:
            versions = crd.get("versions")
            if versions:
                versions.sort(key=sort_key_version)


def apply_supersedes_deprecation(merged: dict) -> None:
    """If multiple API versions exist for a CRD, mark all but the latest as deprecated.

    The latest version keeps its merged flags (including spec.versions[].deprecated from the cluster).
    If only one version exists, leave deprecation as merged from cluster metadata only.
    """
    for _group, crds in merged.items():
        for crd in crds:
            versions = crd.get("versions", [])
            if len(versions) <= 1:
                continue
            latest_name = max(versions, key=lambda v: parse_k8s_api_version(v["name"]))["name"]
            for v in versions:
                if v["name"] != latest_name:
                    v["deprecated"] = True


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
    normalize_crd_versions(merged)
    apply_supersedes_deprecation(merged)
    return merged


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} file1.yaml [file2.yaml ...]")
        sys.exit(1)

    merged_data = merge_yaml_files(sys.argv[1:])
    yaml.dump(merged_data, sys.stdout)
