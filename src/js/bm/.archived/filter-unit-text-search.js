/**
 * A filter allowing the user to search by distinct unit names. Results are displayed in a tooltip as the user types
 * @param {BM.FilterID} filterID
 * @param {string} label
 * @param {string} dataField
 * @param {number} maxLength - Input field length limit
 * @constructor
 * @extends {BM.Filter}
 */
BM.Filter.UnitTextSearch = function(filterID, label, dataField, maxLength)
{
	BM.Filter.call(this, filterID, label, dataField);

	var self = this;
	this.defaultTipTitle = 'Enter a unit search term';
	this.defaultTipText = 'This box displays the units that will be included into the filter.';
	this.filterControl = $(document.createElement('input'))
		.addClass('map-filter-textbox')
		.attr('id', filterID)
		.attr('type', 'text')
		.attr('maxlength', maxLength)
		.attr('placeholder', 'Enter a search term')
		.on('keydown', function(event) {
			// " character is used to delimit RegExp search string, so exclude from input
			if(event.which === 222)
				event.preventDefault();
		})
		.on('keyup mousedown', function(event) {
			// On ESC being pressed, close the tooltip
			if (event.which === $.ui.keyCode.ESCAPE)
			{
				event.preventDefault();
				self.filterControl.blur();
			}
			else
			{
				self.updateUnitFilterMatches();
			}
		})
		.on('change', function() {
			self.values[0] = self.filterControl.val();
		})
		.on('focus', function() {
			self.updateUnitFilterMatches();
		})
		.on('blur', function() {
			self.hideUnitSearchMatches();
		})
		.appendTo(this.filterControlContainer);

	// Bind a tooltip to autocomplete as the user types. This will be closed when the control loses focus
	this.searchMatches = $(document.createElement('div'))
		.attr('id', 'map-unit-filter-search-matches')
		.appendTo(this.filterControlContainer);

	// Track the state of the search tooltip
	this.isTooltipShowing = false;

	// Cache a string containing distinct units to enable client-side searching
	this.distinctUnits = "";

	// Set the maximum number of matches to return (improves performance)
	this.maximumMatchCount = 100;

	this.values[0] = '';

	// Load all distinct unit strings into the array on the client for use with the unit filter tooltip
	$.getJSON(BM.DBQuery.distinctUnits(), function (data)
	{
		for(var i = 0; i < data.length; i++)
		{
			self.distinctUnits += '"' + data[i][self.dataField] + '"';
		}
	});
};

BM.Filter.UnitTextSearch.prototype = Object.create(BM.Filter.prototype);
BM.Filter.UnitTextSearch.prototype.constructor = BM.Filter.UnitTextSearch;

BM.Filter.UnitTextSearch.prototype.updateUnitFilterMatches = function()
{
	// Display in a tooltip, the units containing the characters the user entered
	var unitMatchCount = 0;
	var tipText = "";
	var tipTitle = "";
	var strTerm = this.filterControl.val().toLowerCase();
	var termLength = strTerm.length;

	if (termLength === 0 || strTerm === " ")
	{
		tipTitle = this.defaultTipTitle;
		tipText = this.defaultTipText;
	}
	else
	{
		var rx = new RegExp('"([^"]*' + strTerm.replace('*', '/*') + '[^"]*)"', 'gi');
		var i = 0;
		var result;

		while (result = rx.exec(this.distinctUnits))
		{
			var match = result[1];
			var index = match.toLowerCase().indexOf(strTerm);

			// Check whether the unit name contains the specified search string (case insensitive)
			if (index > -1)
			{
				// Match found, so add it to the tooltip contents. Underline the matched term in place
				var matchedTerm = match.substr(index, termLength);

				tipText += match.substr(0, index) + '<span class="map-unit-filter-match-highlight">' + matchedTerm + '</span>';
				if (index + termLength < match.length)
					tipText += match.substr(index + termLength, match.length - 1) + '<br />';
				else
					tipText += '<br />';

				unitMatchCount++;
			}

			if (unitMatchCount >= this.maximumMatchCount)
				break;
		}

		if (unitMatchCount >= this.maximumMatchCount)
		{
			tipTitle = '<strong>Found ' + unitMatchCount + '+ unit matches.</strong> These will be included in the filtered results.';
		}
		else if (unitMatchCount > 0)
		{
			tipTitle = '<strong>Found ' + unitMatchCount + ' unit matches.</strong> These will be included in the filtered results.';
		}
		else
		{
			tipTitle = 'No units found matching your search term';
			tipText = 'Try making your search less specific.';
		}
	}

	var tipContent =
		'<div class="unit-search-filter-tooltip">' +
			'<div class="tooltip-heading">' + tipTitle + '</div>' +
			'<div class="tooltip-body">' + tipText + '</div>' +
		'</div>';

	this.positionSearchMatches();
	this.searchMatches.html(tipContent);
	this.showUnitSearchMatches();
	this.searchMatches.find('.tooltip-body').mCustomScrollbar({
		axis: 'y',
		autoHideScrollbar: false,
		scrollInertia: 200,
		theme: 'minimal-dark',
		mouseWheel: {
			scrollAmount: 100
		}
	});
};

/**
 * Repositions the filter search matches box upon initial load
 */
BM.Filter.UnitTextSearch.prototype.positionSearchMatches = function()
{
	this.searchMatches
		.css('right', $(document).width() - this.filterControl.offset().left + 5)
		.css('top', this.filterControl.position().top - 2);
};

/**
 * Also hides the tooltip when the filter control is unchecked or loses focus
 */
BM.Filter.UnitTextSearch.prototype.deactivateFilterControl = function()
{
	BM.Filter.prototype.deactivateFilterControl.call(this);
	this.searchMatches.hide();
};

BM.Filter.UnitTextSearch.prototype.showUnitSearchMatches = function()
{
	this.isTooltipShowing = true;
	this.searchMatches.fadeIn(300);
};

BM.Filter.UnitTextSearch.prototype.hideUnitSearchMatches = function()
{
	this.isTooltipShowing = false;
	this.searchMatches.fadeOut(300);
};

BM.Filter.UnitTextSearch.prototype.update = function()
{
	this.filterControl.val(this.values[0]);
	if (this.isTooltipShowing)
		this.filterControl.updateUnitFilterMatches();
};

BM.Filter.UnitTextSearch.prototype.reset = function()
{
	this.values[0] = '';
	this.update();
};

BM.Filter.UnitTextSearch.prototype.toDataFilterString = function()
{
	return "indexof(" + this.dataField + "," + encodeURIComponent("'" + this.values[0] + "'") + ") ge 0";
};

BM.Filter.UnitTextSearch.prototype.toElasticSearchFilter = function()
{
	return JSON.parse('{ "simple_query_string": { "query": "' + this.values[0] + '", "fields": ["' + this.dataField + '"] } }');
};

BM.Filter.UnitTextSearch.prototype.serialiseState = function()
{
	return encodeURIComponent(this.values[0]);
};

BM.Filter.UnitTextSearch.prototype.parseState = function(serialisedState)
{
	if (serialisedState)
	{
		this.values[0] = decodeURIComponent(serialisedState);
		this.update();
	}
};