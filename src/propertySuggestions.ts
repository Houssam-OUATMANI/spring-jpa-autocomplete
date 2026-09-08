export function findClosestProperty(input: string, propertyNames: readonly string[]): string | undefined {
	const normalizedInput = normalize(input);
	let closest: string | undefined;
	let closestDistance = Math.max(3, Math.floor(normalizedInput.length / 3));

	for (const propertyName of propertyNames) {
		const distance = levenshtein(normalizedInput, normalize(propertyName));
		if (distance < closestDistance) {
			closest = propertyName;
			closestDistance = distance;
		}
	}

	return closest;
}

function normalize(value: string): string {
	return value.replace(/_/g, '').toLowerCase();
}

function levenshtein(left: string, right: string): number {
	const row = Array.from({ length: right.length + 1 }, (_, index) => index);

	for (let leftIndex = 1; leftIndex <= left.length; leftIndex++) {
		let diagonal = row[0];
		row[0] = leftIndex;
		for (let rightIndex = 1; rightIndex <= right.length; rightIndex++) {
			const previous = row[rightIndex];
			row[rightIndex] = left[leftIndex - 1] === right[rightIndex - 1]
				? diagonal
				: Math.min(row[rightIndex] + 1, row[rightIndex - 1] + 1, diagonal + 1);
			diagonal = previous;
		}
	}

	return row[right.length];
}
