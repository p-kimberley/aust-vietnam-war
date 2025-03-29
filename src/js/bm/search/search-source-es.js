/**
 * Elasticsearch search source type
 * @param {string} name
 * @param {jQuery} resultTargetEl
 * @param {string} index
 * @param {string} type
 * @param {[string]} fields
 * @constructor
 * @class
 * @extends {BM.SearchSource}
 */
BM.SearchSource.ES = function(name, resultTargetEl, index, type, fields)
{
	BM.SearchSource.call(this, name, resultTargetEl);

	this.index = index;
	this.type = type;
	this.fields = fields;
	this.maxResults = 5;
	this.fieldHighlights = {};
	this.currentAjaxRequest = undefined;		// Stops multiple concurrent requests to the same source

	// Create an associative array of all fields, as we want ES to produce highlighted markup against all fields
	for(var i = 0; i < this.fields.length; i++)
	{
		this.fieldHighlights[this.fields[i]] = {};
	}
};

BM.SearchSource.ES.prototype = Object.create(BM.SearchSource.prototype);
BM.SearchSource.ES.prototype.constructor = BM.SearchSource.ES;

/**
 * Conducts a search against the registered ES index and displays the results
 * @param {string} query
 */
BM.SearchSource.ES.prototype.search = function(query)
{
	BM.SearchSource.prototype.search.call(this, query);

	var self = this;

	if (this.currentAjaxRequest)
	{
		if (this.currentAjaxRequest.abort)
			this.currentAjaxRequest.abort();

		this.currentAjaxRequest = undefined;
	}

	this.currentAjaxRequest = $.ajax({
		url: '/api/es/search/' + this.index + (this.type ? '/' + this.type : ''),
		method: 'POST',
		dataType: 'json',
		contentType: 'application/json',
		data: JSON.stringify({
			"size": this.maxResults,
			"query": {
				"multi_match": {
					"query": query,
					"type": "phrase_prefix",
					"fields": this.fields
				}
			},
			"highlight": {
				"fields": this.fieldHighlights,
				"pre_tags": ["<span class='highlight'>"],
				"post_tags": ["</span>"]
			}
		})
	}).done(function(data) {
		self.currentAjaxRequest = undefined;
		self.displayResults(data);
	}).fail(function(error) {
		// TODO: Add error handler
	});
};

/**
 * @param {{}} data - ES response object
 * @protected
 */
BM.SearchSource.ES.prototype.displayResults = function(data)
{
	if (data.hits.hits.length > 0)
	{
		BM.SearchSource.prototype.displayResults.call(this, data);

		var self = this;
		var resultsList = $(document.createElement('ul'));
		var resultCategory = $(document.createElement('div'))
			.addClass('result-category')
			.append('<div class="header">' + this.name + ' (' + data.hits.total.toLocaleString() + ')</div>')
			.append(resultsList);

		$.each(data.hits.hits, function (i, result)
		{
			var resultEl = $(document.createElement('li'))
				.append('<span class="header">' + self.generateResultHeader(result) + '</span>')
				.append('<span class="subtext">' + self.generateResultSubtext(result) + '</span>')
				.on('click', function () {
					self.handleResultSelected(result);
				});

			resultsList.append(resultEl);
		});

		this.resultTargetEl.append(resultCategory);
	}
};

/**
 * Retrieves the first highlight markup string from the ES response
 * @param {{}} data
 */
BM.SearchSource.ES.prototype.getHighlight = function(data)
{
	var highlightMarkup = null;
	$.each(this.fields, function(i, field) {
		if (data.highlight[field])
		{
			highlightMarkup = data.highlight[field];
			return 0;
		}
	});

	return highlightMarkup;
};