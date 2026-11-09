const fs = require('fs');
const text = fs.readFileSync('src/test/extension.test.ts', 'utf8');
console.log('Text length:', text.length);

function oldMask(text) {
	const chars = text.split('');
	let mode;

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

// Fast regex replacement:
const MASK_REGEX = /\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|"""[\s\S]*?"""|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g;
function fastMaskRegex(text) {
	return text.replace(MASK_REGEX, (match) => {
		// Replace non-newline characters with spaces to preserve line/col alignment
		let result = '';
		for (let i = 0; i < match.length; i++) {
			const c = match.charCodeAt(i);
			result += (c === 10 || c === 13) ? match[i] : ' ';
		}
		return result;
	});
}

const t0 = performance.now();
for (let i = 0; i < 20; i++) oldMask(text);
const t1 = performance.now();
console.log('Old mask 20 iterations:', (t1 - t0).toFixed(2), 'ms');

const t2 = performance.now();
for (let i = 0; i < 20; i++) fastMaskRegex(text);
const t3 = performance.now();
console.log('Fast regex mask 20 iterations:', (t3 - t2).toFixed(2), 'ms');

// Verify output identical
const outOld = oldMask(text);
const outFast = fastMaskRegex(text);
console.log('Outputs equal?', outOld === outFast);
if (outOld !== outFast) {
	console.log('Length diff:', outOld.length, outFast.length);
	for (let i = 0; i < outOld.length; i++) {
		if (outOld[i] !== outFast[i]) {
			console.log(`Mismatch at ${i}: old='${outOld.slice(i, i+15)}' fast='${outFast.slice(i, i+15)}'`);
			break;
		}
	}
}

