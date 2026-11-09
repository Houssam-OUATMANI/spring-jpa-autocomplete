export interface JavaParameter {
	readonly name: string;
	readonly type: string;
	readonly isParamAnnotated: boolean;
	readonly paramName?: string;
	readonly nameOffset: number;
}

export interface JavaParameterPart {
	readonly text: string;
	readonly startOffset: number;
}

const JAVA_MASK_REGEX = /\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|"""[\s\S]*?"""|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g;

let lastMaskedInput: string | undefined;
let lastMaskedOutput: string | undefined;

export function maskJavaSource(text: string): string {
	if (lastMaskedInput === text) {
		return lastMaskedOutput!;
	}
	const result = text.replace(JAVA_MASK_REGEX, (match) => {
		let spaces = '';
		for (let i = 0; i < match.length; i++) {
			const c = match.charCodeAt(i);
			spaces += (c === 10 || c === 13) ? match[i] : ' ';
		}
		return spaces;
	});
	lastMaskedInput = text;
	lastMaskedOutput = result;
	return result;
}

export function splitTopLevelParameters(paramsText: string, baseOffset = 0): JavaParameterPart[] {
	const parts: JavaParameterPart[] = [];
	let start = 0;
	let angleDepth = 0;
	let parenthesisDepth = 0;
	let bracketDepth = 0;
	let quote: '"' | "'" | undefined;

	for (let index = 0; index < paramsText.length; index++) {
		const character = paramsText[index];
		if (quote) {
			if (character === '\\') {
				index++;
			} else if (character === quote) {
				quote = undefined;
			}
			continue;
		}
		if (character === '"' || character === "'") {
			quote = character;
			continue;
		}
		switch (character) {
			case '<': angleDepth++; break;
			case '>': angleDepth = Math.max(0, angleDepth - 1); break;
			case '(': parenthesisDepth++; break;
			case ')': parenthesisDepth = Math.max(0, parenthesisDepth - 1); break;
			case '[': bracketDepth++; break;
			case ']': bracketDepth = Math.max(0, bracketDepth - 1); break;
			case ',':
				if (angleDepth === 0 && parenthesisDepth === 0 && bracketDepth === 0) {
					parts.push({ text: paramsText.slice(start, index), startOffset: baseOffset + start });
					start = index + 1;
				}
				break;
		}
	}
	parts.push({ text: paramsText.slice(start), startOffset: baseOffset + start });
	return parts;
}

export function parseJavaParameter(part: JavaParameterPart): JavaParameter | undefined {
	const paramNameMatch = part.text.match(/([A-Za-z_$][\w$]*)\s*(?:\.\.\.)?\s*$/);
	if (!paramNameMatch || paramNameMatch.index === undefined) {
		return undefined;
	}
	const name = paramNameMatch[1];
	const beforeName = part.text.slice(0, paramNameMatch.index);
	const paramName = part.text.match(/@Param\s*\(\s*(?:(?:value|name)\s*=\s*)?"([^"]+)"\s*\)/)?.[1];
	const type = beforeName
		.replace(/@\w+(?:\s*\([^)]*\))?\s*/g, ' ')
		.replace(/\bfinal\s+/g, ' ')
		.replace(/\.\.\.\s*$/, '')
		.trim();
	if (!type) {
		return undefined;
	}
	return {
		name,
		type,
		isParamAnnotated: paramName !== undefined,
		paramName,
		nameOffset: part.startOffset + paramNameMatch.index,
	};
}

export function parseJavaParameters(paramsText: string, baseOffset = 0): JavaParameter[] {
	return splitTopLevelParameters(paramsText, baseOffset)
		.map(parseJavaParameter)
		.filter((parameter): parameter is JavaParameter => parameter !== undefined);
}

export function decodeJavaString(value: string): string {
	return value.replace(/\\([\\"'nrtbf])/g, (_match, escaped: string) => ({
		'\\': '\\',
		'"': '"',
		"'": "'",
		n: '\n',
		r: '\r',
		t: '\t',
		b: '\b',
		f: '\f',
	}[escaped] ?? escaped));
}
