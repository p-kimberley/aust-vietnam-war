/**
 * Base class for a type of search source, such as incidents, media, operations etc.
 * A search source defines what resources are searched against, how results are presented to the user
 * and the actions carried out upon selecting a result.
 * @param {string} name - Used as the caption in the category heading
 * @param {jQuery} resultTargetEl - Result DOM is appended to this element
 * @constructor
 * @class
 */
BM.SearchSource = function(name, resultTargetEl) {
	this.name = name;
	this.icon = null;	// TODO: Insert ref to blank icon here
	this.resultTargetEl = resultTargetEl;
	this.enableShowOnMapButton = false;
};

/**
 * @param {string} query
 * @public
 */
BM.SearchSource.prototype.search = function(query)
{
	this.resultTargetEl
		.empty()
		.append('<div class="no-results">No matches found</div>');
};

/**
 * This is only called if one or more categories returns results
 * @param {{}} data
 */
BM.SearchSource.prototype.displayResults = function(data)
{
	this.resultTargetEl.find('.no-results').remove();
};

/**
 * @param {{}} data
 * @returns {string}
 */
BM.SearchSource.prototype.generateResultHeader = function(data)
{};

/**
 * @param {{}} data
 * @returns {string}
 */
BM.SearchSource.prototype.generateResultSubtext = function(data)
{};

/**
 * Responds to the user selecting a search result
 * @param {{}} data
 */
BM.SearchSource.prototype.handleResultSelected = function(data)
{};