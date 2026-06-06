export type UpgradeRisk = 'low' | 'medium' | 'high';

export type FieldChangeType =
	| 'type_change'
	| 'added'
	| 'removed'
	| 'enum_added'
	| 'enum_removed'
	| 'default_changed'
	| 'required_added'
	| 'optional_added';

export type NewResource = {
	kind: string;
	apiVersion: string;
	description: string;
};

export type RemovedResource = {
	kind: string;
	apiVersion: string;
	reason: string;
};

export type FieldChange = {
	field: string;
	changeType: FieldChangeType;
	before: string;
	after: string;
	networkBehavior: string;
};

export type ModifiedResource = {
	kind: string;
	changes: FieldChange[];
};

export type DeprecatedItem = {
	kind: string;
	field: string;
	removedInVersion: string;
	migrationPath: string;
};

export type BreakingChange = {
	kind: string;
	field: string;
	description: string;
	migrationSteps: string[];
	yamlBefore: string;
	yamlAfter: string;
};

export type ReleaseNotes = {
	summary: string;
	newResources: NewResource[];
	removedResources: RemovedResource[];
	modifiedResources: ModifiedResource[];
	deprecated: DeprecatedItem[];
	breakingChanges: BreakingChange[];
	operationalImpact: string;
	upgradeRisk: UpgradeRisk;
	upgradeRiskJustification: string;
	upgradeChecklist: string[];
	estimatedEffort: string;
};

export type ReleaseNotesEntry = {
	toVer: string;
	fromVer: string;
	notes: ReleaseNotes;
	timestamp: number;
	source: 'comparison' | 'mock';
};

export type ReleaseTimelineItem = {
	version: string;
	label: string;
	tag?: 'latest';
};
