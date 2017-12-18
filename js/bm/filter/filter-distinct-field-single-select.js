/**
 * Specialisation of multi-select list, allowing user to choose from a list of operations. Use of callback is required due to AJAX request.
 * @param {BM.FilterID} filterID
 * @param {string} label
 * @param {string} esIndex - Name of the Elasticsearch index to query
 * @param {string} fieldName - Field name to retrieve distinct values from
 * @param {Number} minDocCount - Minimum number of results for an option to be included
 * @param callback
 * @constructor
 * @extends {BM.Filter.SingleSelectList}
 */
BM.Filter.DistinctFieldSingleSelect = function(filterID, label, esIndex, fieldName, minDocCount, callback)
{
	var self = this;
	var options = [];

	// Generate an array of all distinct operations and pass this to the parent constructor
	$.ajax({
		url: '/api/es/search/' + esIndex,
		method: 'POST',
		dataType: 'json',
		contentType: 'application/json',
		data: JSON.stringify({
			"size": 0,
			"aggs": {
				"terms": {
					"terms": {
						"field": fieldName + ".raw",
						"size": 50,
						"min_doc_count": minDocCount
					}
				}
			}
		})
	}).done(function (data)
	{
		$.each(data.aggregations.terms.buckets, function (i, item)
		{
			options.push({
				name: item.key + ' (' + item.doc_count.toLocaleString() + ')',
				value: item.key
			});
		});

		BM.Filter.SingleSelectList.call(self, filterID, label, fieldName, {
			quoteValue: 'true',
			nameValueArray: options
		});

		if (callback)
			callback();
	});
};

BM.Filter.DistinctFieldSingleSelect.prototype = Object.create(BM.Filter.SingleSelectList.prototype);
BM.Filter.DistinctFieldSingleSelect.prototype.constructor = BM.Filter.DistinctFieldSingleSelect;
