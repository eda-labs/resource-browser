import type { BulkDiffReport } from './types';

function escapeCsv(value: string): string {
	if (value == null) return '';
	const s = String(value).replace(/"/g, '""');
	return `"${s}"`;
}

export function downloadBulkDiffReport(
	report: BulkDiffReport,
	format: 'json' | 'text' | 'markdown' | 'csv'
): void {
	let content = '';
	let filename = '';
	let mimeType = '';
	const header = `Report\nGenerated: ${report.generatedAt}\nSource: ${report.sourceRelease} ${report.sourceVersion}\nTarget: ${report.targetRelease} ${report.targetVersion}\nTotal CRDs: ${report.crds.length}\n\n`;

	if (format === 'json') {
		content = JSON.stringify(report, null, 2);
		filename = `bulk-diff-${report.sourceRelease}-${report.sourceVersion}_to_${report.targetRelease}-${report.targetVersion}.json`;
		mimeType = 'application/json';
	} else if (format === 'text') {
		const lines: string[] = [header, 'CRDs:\n'];
		for (const c of report.crds) {
			lines.push(`- ${c.name} (${c.kind}, ${c.version}) [${c.status}]`);
			for (const d of c.details) {
				lines.push(`    ${d}`);
			}
		}
		content = lines.join('\n');
		filename = `bulk-diff-${report.sourceRelease}-${report.sourceVersion}_to_${report.targetRelease}-${report.targetVersion}.txt`;
		mimeType = 'text/plain';
	} else if (format === 'markdown') {
		const md: string[] = [];
		md.push('# Bulk Diff Report');
		md.push(`**Generated:** ${report.generatedAt}`);
		md.push(`**Source:** ${report.sourceRelease} ${report.sourceVersion}`);
		md.push(`**Target:** ${report.targetRelease} ${report.targetVersion}`);
		md.push(`**Total CRDs:** ${report.crds.length}`);
		md.push('\n---\n');
		for (const c of report.crds) {
			md.push(`## ${c.name} (${c.kind}, ${c.version})`);
			md.push(`- Status: **${c.status}**`);
			if (c.details.length > 0) {
				md.push('\n**Details:**');
				for (const d of c.details) {
					md.push(`- ${d}`);
				}
			} else {
				md.push('\n_No additional details._');
			}
			md.push('');
		}
		content = md.join('\n');
		filename = `bulk-diff-${report.sourceRelease}-${report.sourceVersion}_to_${report.targetRelease}-${report.targetVersion}.md`;
		mimeType = 'text/markdown';
	} else if (format === 'csv') {
		const rows: string[] = [];
		rows.push(['name', 'kind', 'version', 'status', 'detail'].map(escapeCsv).join(','));
		for (const c of report.crds) {
			if (c.details.length > 0) {
				for (const d of c.details) {
					rows.push(
						[escapeCsv(c.name), escapeCsv(c.kind), escapeCsv(c.version), escapeCsv(c.status), escapeCsv(d)].join(',')
					);
				}
			} else {
				rows.push(
					[escapeCsv(c.name), escapeCsv(c.kind), escapeCsv(c.version), escapeCsv(c.status), escapeCsv('')].join(',')
				);
			}
		}
		content = rows.join('\n');
		filename = `bulk-diff-${report.sourceRelease}-${report.sourceVersion}_to_${report.targetRelease}-${report.targetVersion}.csv`;
		mimeType = 'text/csv';
	}

	const blob = new Blob([content], { type: mimeType });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	a.click();
	URL.revokeObjectURL(url);
}
