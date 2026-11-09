export interface MongoOperatorDocumentation {
	readonly name: string;
	readonly category: 'Logical' | 'Comparison' | 'Element' | 'Evaluation' | 'Array' | 'Geospatial' | 'Aggregation';
	readonly description: string;
	readonly syntax: string;
	readonly example: string;
}

const operators: readonly MongoOperatorDocumentation[] = [
	{ name: '$and', category: 'Logical', description: 'Matches documents that satisfy every clause in the array.', syntax: '{ $and: [ { <expression> }, ... ] }', example: "{ '$and': [ { 'active': true }, { 'age': { '$gte': 18 } } ] }" },
	{ name: '$or', category: 'Logical', description: 'Matches documents that satisfy at least one clause in the array.', syntax: '{ $or: [ { <expression> }, ... ] }', example: "{ '$or': [ { 'status': 'A' }, { 'qty': { '$lt': 30 } } ] }" },
	{ name: '$nor', category: 'Logical', description: 'Matches documents that fail all clauses in the array.', syntax: '{ $nor: [ { <expression> }, ... ] }', example: "{ '$nor': [ { 'status': 'A' }, { 'qty': { '$lt': 30 } } ] }" },
	{ name: '$not', category: 'Logical', description: 'Inverts the effect of a field operator expression.', syntax: '{ field: { $not: { <operator>: <value> } } }', example: "{ 'price': { '$not': { '$gt': 100 } } }" },
	{ name: '$eq', category: 'Comparison', description: 'Matches values equal to the specified value.', syntax: '{ field: { $eq: value } }', example: "{ 'status': { '$eq': 'A' } }" },
	{ name: '$ne', category: 'Comparison', description: 'Matches values not equal to the specified value.', syntax: '{ field: { $ne: value } }', example: "{ 'status': { '$ne': 'A' } }" },
	{ name: '$gt', category: 'Comparison', description: 'Matches values greater than the specified value.', syntax: '{ field: { $gt: value } }', example: "{ 'price': { '$gt': 10 } }" },
	{ name: '$gte', category: 'Comparison', description: 'Matches values greater than or equal to the specified value.', syntax: '{ field: { $gte: value } }', example: "{ 'price': { '$gte': 10 } }" },
	{ name: '$lt', category: 'Comparison', description: 'Matches values less than the specified value.', syntax: '{ field: { $lt: value } }', example: "{ 'price': { '$lt': 100 } }" },
	{ name: '$lte', category: 'Comparison', description: 'Matches values less than or equal to the specified value.', syntax: '{ field: { $lte: value } }', example: "{ 'price': { '$lte': 100 } }" },
	{ name: '$in', category: 'Comparison', description: 'Matches a field whose value equals any value in the supplied array.', syntax: '{ field: { $in: [ value1, value2, ... ] } }', example: "{ 'status': { '$in': ['A', 'D'] } }" },
	{ name: '$nin', category: 'Comparison', description: 'Matches a field whose value is not in the supplied array.', syntax: '{ field: { $nin: [ value1, value2, ... ] } }', example: "{ 'status': { '$nin': ['A', 'D'] } }" },
	{ name: '$exists', category: 'Element', description: 'Matches documents that contain (or omit) the specified field.', syntax: '{ field: { $exists: boolean } }', example: "{ 'middleName': { '$exists': false } }" },
	{ name: '$type', category: 'Element', description: 'Matches fields with the specified BSON type.', syntax: '{ field: { $type: type } }', example: "{ 'score': { '$type': 'number' } }" },
	{ name: '$mod', category: 'Evaluation', description: 'Matches numbers whose remainder equals the specified value.', syntax: '{ field: { $mod: [ divisor, remainder ] } }', example: "{ 'quantity': { '$mod': [10, 0] } }" },
	{ name: '$regex', category: 'Evaluation', description: 'Matches strings using a regular expression. Add `$options: "i"` for case-insensitive matching.', syntax: '{ field: { $regex: pattern, $options: options } }', example: "{ 'title': { '$regex': ?0, '$options': 'i' } }" },
	{ name: '$options', category: 'Evaluation', description: 'Sets regex options: `i` ignores case, `m` enables multiline, `s` lets dot match newlines, and `x` ignores pattern whitespace.', syntax: '{ field: { $regex: pattern, $options: "i" } }', example: "{ 'title': { '$regex': ?0, '$options': 'im' } }" },
	{ name: '$text', category: 'Evaluation', description: 'Performs a text search on a collection with a text index.', syntax: '{ $text: { $search: string, $language: language } }', example: "{ '$text': { '$search': 'coffee' } }" },
	{ name: '$where', category: 'Evaluation', description: 'Matches documents using a server-side JavaScript expression. Prefer standard query operators when possible.', syntax: '{ $where: JavaScript expression }', example: "{ '$where': 'this.score > 10' }" },
	{ name: '$all', category: 'Array', description: 'Matches arrays that contain every specified element.', syntax: '{ field: { $all: [ value1, value2, ... ] } }', example: "{ 'tags': { '$all': ['java', 'spring'] } }" },
	{ name: '$elemMatch', category: 'Array', description: 'Matches arrays with at least one element satisfying all nested criteria.', syntax: '{ field: { $elemMatch: { <expression> } } }', example: "{ 'results': { '$elemMatch': { '$gte': 80, '$lt': 90 } } }" },
	{ name: '$size', category: 'Array', description: 'Matches arrays with the specified number of elements.', syntax: '{ field: { $size: number } }', example: "{ 'tags': { '$size': 3 } }" },
	{ name: '$geoWithin', category: 'Geospatial', description: 'Matches geospatial data within a defined geometry.', syntax: '{ field: { $geoWithin: { <geometry> } } }', example: "{ 'location': { '$geoWithin': { '$centerSphere': [[-73, 40], 0.01] } } }" },
	{ name: '$geoIntersects', category: 'Geospatial', description: 'Matches geospatial data that intersects a GeoJSON geometry.', syntax: '{ field: { $geoIntersects: { $geometry: geometry } } }', example: "{ 'location': { '$geoIntersects': { '$geometry': { 'type': 'Point', 'coordinates': [-73, 40] } } } }" },
	{ name: '$near', category: 'Geospatial', description: 'Returns geospatial results ordered by distance from a point.', syntax: '{ field: { $near: { $geometry: point, $maxDistance: distance } } }', example: "{ 'location': { '$near': { '$geometry': { 'type': 'Point', 'coordinates': [-73, 40] }, '$maxDistance': 5000 } } }" },
	{ name: '$nearSphere', category: 'Geospatial', description: 'Returns geospatial results ordered by spherical distance from a point.', syntax: '{ field: { $nearSphere: { $geometry: point } } }', example: "{ 'location': { '$nearSphere': { '$geometry': { 'type': 'Point', 'coordinates': [-73, 40] } } } }" },
	{ name: '$expr', category: 'Evaluation', description: 'Uses aggregation expressions inside a query predicate.', syntax: '{ $expr: { <expression> } }', example: "{ '$expr': { '$gt': ['$spent', '$budget'] } }" },
	{ name: '$jsonSchema', category: 'Evaluation', description: 'Matches documents that satisfy a JSON Schema validation expression.', syntax: '{ $jsonSchema: { <schema> } }', example: "{ '$jsonSchema': { 'required': ['name'] } }" },
	{ name: '$bitsAllSet', category: 'Evaluation', description: 'Matches values where all specified bit positions are set.', syntax: '{ field: { $bitsAllSet: bitmask } }', example: "{ 'flags': { '$bitsAllSet': 7 } }" },
	{ name: '$bitsAnySet', category: 'Evaluation', description: 'Matches values where any specified bit position is set.', syntax: '{ field: { $bitsAnySet: bitmask } }', example: "{ 'flags': { '$bitsAnySet': 3 } }" },
	{ name: '$bitsAllClear', category: 'Evaluation', description: 'Matches values where all specified bit positions are clear.', syntax: '{ field: { $bitsAllClear: bitmask } }', example: "{ 'flags': { '$bitsAllClear': 7 } }" },
	{ name: '$bitsAnyClear', category: 'Evaluation', description: 'Matches values where any specified bit position is clear.', syntax: '{ field: { $bitsAnyClear: bitmask } }', example: "{ 'flags': { '$bitsAnyClear': 3 } }" },
	{ name: '$match', category: 'Aggregation', description: 'Filters aggregation pipeline documents using a query predicate.', syntax: '{ $match: { <query predicate> } }', example: "{ '$match': { 'active': true } }" },
	{ name: '$project', category: 'Aggregation', description: 'Shapes the output documents by including, excluding, or computing fields.', syntax: '{ $project: { <field>: 1 | 0 | <expression> } }', example: "{ '$project': { 'title': 1, 'shortTitle': { '$substr': ['$title', 0, 10] } } }" },
	{ name: '$group', category: 'Aggregation', description: 'Groups documents by an identifier and computes accumulator values.', syntax: '{ $group: { _id: <expression>, <field>: <accumulator> } }', example: "{ '$group': { '_id': '$status', 'count': { '$sum': 1 } } }" },
	{ name: '$sort', category: 'Aggregation', description: 'Sorts pipeline documents by one or more fields.', syntax: '{ $sort: { <field>: 1 | -1 } }', example: "{ '$sort': { 'createdAt': -1 } }" },
	{ name: '$limit', category: 'Aggregation', description: 'Limits the number of documents passed to the next stage.', syntax: '{ $limit: positiveInteger }', example: "{ '$limit': 20 }" },
	{ name: '$skip', category: 'Aggregation', description: 'Skips the specified number of documents.', syntax: '{ $skip: positiveInteger }', example: "{ '$skip': 10 }" },
	{ name: '$unwind', category: 'Aggregation', description: 'Deconstructs an array field into one output document per element.', syntax: '{ $unwind: "$arrayField" }', example: "{ '$unwind': '$items' }" },
	{ name: '$lookup', category: 'Aggregation', description: 'Performs a left outer join with another collection in the same database.', syntax: '{ $lookup: { from, localField, foreignField, as } }', example: "{ '$lookup': { 'from': 'orders', 'localField': '_id', 'foreignField': 'userId', 'as': 'orders' } }" },
	{ name: '$count', category: 'Aggregation', description: 'Counts the documents at this point in the pipeline.', syntax: '{ $count: outputField }', example: "{ '$count': 'total' }" },
	{ name: '$addFields', category: 'Aggregation', description: 'Adds computed fields while preserving existing fields.', syntax: '{ $addFields: { <field>: <expression> } }', example: "{ '$addFields': { 'total': { '$add': ['$price', '$tax'] } } }" },
	{ name: '$set', category: 'Aggregation', description: 'Alias for `$addFields` in an aggregation pipeline.', syntax: '{ $set: { <field>: <expression> } }', example: "{ '$set': { 'status': 'processed' } }" },
	{ name: '$unset', category: 'Aggregation', description: 'Removes one or more fields from pipeline documents.', syntax: '{ $unset: field | [ fields ] }', example: "{ '$unset': ['temporaryField'] }" },
	{ name: '$replaceRoot', category: 'Aggregation', description: 'Replaces each input document with the specified embedded document.', syntax: '{ $replaceRoot: { newRoot: <expression> } }', example: "{ '$replaceRoot': { 'newRoot': '$profile' } }" },
	{ name: '$replaceWith', category: 'Aggregation', description: 'Replaces each input document with the specified expression.', syntax: '{ $replaceWith: <expression> }', example: "{ '$replaceWith': '$profile' }" },
	{ name: '$sum', category: 'Aggregation', description: 'Sums numeric values, commonly used as a `$group` accumulator.', syntax: '{ $group: { total: { $sum: expression } } }', example: "{ '$group': { '_id': '$status', 'count': { '$sum': 1 } } }" },
	{ name: '$avg', category: 'Aggregation', description: 'Calculates the average of numeric values in a group.', syntax: '{ $group: { average: { $avg: expression } } }', example: "{ '$group': { '_id': '$category', 'averagePrice': { '$avg': '$price' } } }" },
	{ name: '$min', category: 'Aggregation', description: 'Returns the lowest value in a group or expression list.', syntax: '{ $group: { lowest: { $min: expression } } }', example: "{ '$group': { '_id': '$category', 'lowestPrice': { '$min': '$price' } } }" },
	{ name: '$max', category: 'Aggregation', description: 'Returns the highest value in a group or expression list.', syntax: '{ $group: { highest: { $max: expression } } }', example: "{ '$group': { '_id': '$category', 'highestPrice': { '$max': '$price' } } }" },
	{ name: '$push', category: 'Aggregation', description: 'Adds each group result to an output array.', syntax: '{ $group: { values: { $push: expression } } }', example: "{ '$group': { '_id': '$status', 'titles': { '$push': '$title' } } }" },
	{ name: '$addToSet', category: 'Aggregation', description: 'Adds unique group values to an output array.', syntax: '{ $group: { values: { $addToSet: expression } } }', example: "{ '$group': { '_id': '$status', 'authors': { '$addToSet': '$author' } } }" },
	{ name: '$first', category: 'Aggregation', description: 'Returns the first value in a group, usually after sorting.', syntax: '{ $group: { firstValue: { $first: expression } } }', example: "{ '$group': { '_id': '$author', 'firstTitle': { '$first': '$title' } } }" },
	{ name: '$last', category: 'Aggregation', description: 'Returns the last value in a group, usually after sorting.', syntax: '{ $group: { lastValue: { $last: expression } } }', example: "{ '$group': { '_id': '$author', 'lastTitle': { '$last': '$title' } } }" },
	{ name: '$concat', category: 'Aggregation', description: 'Concatenates strings in an aggregation expression.', syntax: '{ $concat: [ expression1, expression2, ... ] }', example: "{ '$project': { 'label': { '$concat': ['$firstName', ' ', '$lastName'] } } }" },
	{ name: '$toLower', category: 'Aggregation', description: 'Converts a string expression to lowercase.', syntax: '{ $toLower: expression }', example: "{ '$project': { 'normalized': { '$toLower': '$email' } } }" },
	{ name: '$toUpper', category: 'Aggregation', description: 'Converts a string expression to uppercase.', syntax: '{ $toUpper: expression }', example: "{ '$project': { 'code': { '$toUpper': '$country' } } }" },
	{ name: '$cond', category: 'Aggregation', description: 'Evaluates a condition and returns one of two expressions.', syntax: '{ $cond: { if: condition, then: value, else: value } }', example: "{ '$project': { 'label': { '$cond': { 'if': { '$gte': ['$score', 50] }, 'then': 'pass', 'else': 'fail' } } } }" },
	{ name: '$ifNull', category: 'Aggregation', description: 'Returns a fallback expression when the input is null or missing.', syntax: '{ $ifNull: [ expression, fallback ] }', example: "{ '$project': { 'displayName': { '$ifNull': ['$name', 'Anonymous'] } } }" },
	{ name: '$dateToString', category: 'Aggregation', description: 'Formats a date as a string.', syntax: '{ $dateToString: { format: format, date: expression } }', example: "{ '$project': { 'day': { '$dateToString': { 'format': '%Y-%m-%d', 'date': '$createdAt' } } } }" },
	{ name: '$geoNear', category: 'Aggregation', description: 'Adds distance information and filters documents by proximity; it must be the first stage.', syntax: '{ $geoNear: { near: point, distanceField: field } }', example: "{ '$geoNear': { 'near': { 'type': 'Point', 'coordinates': [-73, 40] }, 'distanceField': 'distance' } }" },
	{ name: '$facet', category: 'Aggregation', description: 'Runs multiple sub-pipelines on the same input documents.', syntax: '{ $facet: { outputName: [ <stage>, ... ] } }', example: "{ '$facet': { 'byStatus': [{ '$sortByCount': '$status' }] } }" },
	{ name: '$unionWith', category: 'Aggregation', description: 'Combines pipeline results with documents from another collection.', syntax: '{ $unionWith: { coll: collection, pipeline: [ <stage>, ... ] } }', example: "{ '$unionWith': { 'coll': 'archivedUsers' } }" },
];

const operatorLookup = new Map(operators.map((operator) => [operator.name, operator]));

export function getMongoOperatorDocumentation(operator: string): MongoOperatorDocumentation | undefined {
	return operatorLookup.get(operator);
}

export function getMongoOperators(): readonly MongoOperatorDocumentation[] {
	return operators;
}

export function formatMongoOperatorDocumentation(documentation: MongoOperatorDocumentation): string {
	return `**MongoDB ${documentation.category} operator**\n\n### \`${documentation.name}\`\n${documentation.description}\n\n**Syntax**\n\`${documentation.syntax}\`\n\n**Example**\n\`${documentation.example}\``;
}
