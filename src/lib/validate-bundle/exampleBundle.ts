/** Example three-document bundle for per-resource schema validation. */
export const EXAMPLE_BUNDLE_YAML = `apiVersion: topologies.eda.nokia.com/v1
kind: Topology
metadata:
  name: lab-topology
  namespace: eda
spec:
  enabled: true
  uiName: Lab Topology
  overlays:
    - enabled: true
      key: default
---
apiVersion: core.eda.nokia.com/v1
kind: TopoNode
metadata:
  name: leaf-01
  namespace: eda
spec:
  platform: 7220 IXR-D3L
  operatingSystem: srl
  version: "24.10.1"
  onBoarded: false
  nodeProfile: default-node-profile
---
apiVersion: interfaces.eda.nokia.com/v1
kind: Interface
metadata:
  name: ethernet-1-1
  namespace: eda
spec:
  enabled: true
  type: Interface
  members:
    - interface: ethernet-1-1
      node: leaf-01
`;
