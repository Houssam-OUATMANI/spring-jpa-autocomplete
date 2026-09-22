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

export function maskJavaSource(text: string): string {
	const chars = [...text];
	let mode: 'lineComment' | 'blockComment' | 'string' | 'char' | 'textBlock' | undefined;

	for (let index = 0; index < text.length; index++) {
		const next = text[index + 1];
		if (!mode) {
			if (text[index] === '/' && next === '/') {
				chars[index] = ' ';
				chars[index + 1] = ' ';
				index++;
				mode = 'lineComment';
			} else if (text[index] === '/' && next === '*') {
				chars[index] = ' ';
				chars[index + 1] = ' ';
				index++;
				mode = 'blockComment';
			} else if (text.startsWith('"""', index)) {
				chars[index] = chars[index + 1] = chars[index + 2] = ' ';
				index += 2;
				mode = 'textBlock';
			} else if (text[index] === '"') {
				chars[index] = ' ';
				mode = 'string';
			} else if (text[index] === "'") {
				chars[index] = ' ';
				mode = 'char';
			}
			continue;
		}

		if (mode === 'lineComment') {
			if (text[index] !== '\r' && text[index] !== '\n') {
				chars[index] = ' ';
			} else {
				mode = undefined;
			}
		} else if (mode === 'blockComment') {
			if (text[index] === '*' && next === '/') {
				chars[index] = chars[index + 1] = ' ';
				index++;
				mode = undefined;
			} else if (text[index] !== '\r' && text[index] !== '\n') {
				chars[index] = ' ';
			}
		} else if (mode === 'textBlock') {
			if (text.startsWith('"""', index)) {
				chars[index] = chars[index + 1] = chars[index + 2] = ' ';
				index += 2;
				mode = undefined;
			} else if (text[index] !== '\r' && text[index] !== '\n') {
				chars[index] = ' ';
			}
		} else if (mode === 'string' || mode === 'char') {
			if (text[index] === '\\') {
				chars[index] = ' ';
				if (index + 1 < text.length) {
					chars[index + 1] = ' ';
					index++;
				}
			} else if ((mode === 'string' && text[index] === '"') || (mode === 'char' && text[index] === "'")) {
				chars[index] = ' ';
				mode = undefined;
			} else if (text[index] !== '\r' && text[index] !== '\n') {
				chars[index] = ' ';
			}
		}
	}

	return chars.join('');
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
