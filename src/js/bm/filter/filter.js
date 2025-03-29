
BM.FilterID = {
	contact: {
		dataSource: 'contact-data-source',
		unitsInvolved: 'contact-units-involved',
		operationName: 'contact-op-name',
		unitTask: 'contact-unit-task',
		hourOfDay: 'contact-hour',
		friendlyStrength: 'contact-fr-strength',
		friendlyCas: 'contact-fr-cas',
		enemyStrength: 'contact-en-strength',
		enemyCas: 'contact-en-cas',
		type: 'contact-type',
		description: 'contact-description',
		hasNotes: 'contact-has-notes'
	},
	sortie: {
		dataSource: 'sortie-data-source',
		msnFunc: 'sortie-msn-func',
		serviceSupported: 'sortie-service-supp',
		opSupported: 'sortie-op-supp',
		countryOrigin: 'sortie-country-origin',
		launchBase: 'sortie-launch-base',
		aircraftType: 'sortie-aircraft-type',
		numAircraft: 'sortie-num-aircraft',
		timeOfDay: 'sortie-time-of-day',
		targetObj: 'sortie-target-obj'
	},
	navalGunfire: {
		shipType: 'ngs-ship-type',
		shipName: 'ngs-ship-name',
		operationName: 'ngs-op-name',
		operationType: 'ngs-op-type',
		forceSupported: 'ngs-force-supported',
		targetCorpsArea: 'ngs-corps-area',
		targetType: 'ngs-target-type',
		timeOfDay: 'ngs-time-of-day'
	}
};

/**
 * Base interface representing a data filter. Encapsulates UI functionality, serialisation and generation of a data service filter parameter.
 * Designed to be added to a BM.FilterController once initialised
 * @param {BM.FilterID} filterID - Internal name of the filter, used for serialisation
 * @param {string} label - Text to use as the checkbox label
 * @param {string} dataField - Name of the data field the filter is bound to (i.e. Fr_Units_Present)
 * @constructor
 */
BM.Filter = function(filterID, label, dataField)
{
	this.filterID = filterID;                   // Identifies the filter and enables serialisation
	this.label = label;                         // Checkbox label / filter's friendly name
	this.selectorControlContainer = null;       // Contains the filter's checkbox selector
	this.selectorControl = null;                // Selector (i.e. checkbox) used to enable/disable the filter
	this.filterControlContainer = null;         // Container for the filter control, used to hide the control from view
	this.filterControl = null;                  // UI element for the actual filter control. Derived classes create this element and add it to the filterControlContainer
	this.type = null;                           // Implemented by derived classes
	this.dataField = dataField;                 // Data field the filter is bound to
	this.values = [];                           // Array of filter values (implemented by derived class)
	this.useInAnalytics = true;					// Whether this filter applies to analytics via ElasticSearch

	this.selectorControlContainer = $(document.createElement('div'))
		.addClass('filter-selector-container');
	this.filterControlContainer = $(document.createElement('div'))
		.addClass('filter-control-container')
		.attr('id', 'filter-container-' + this.filterID)
		.hide();

	var selectorID = 'filter-selector-' + this.filterID;
	this.selectorControl = $(document.createElement('input'))
		.attr('id', selectorID)
		.addClass('filter-selector-control')
		.attr('type', 'checkbox')
		.appendTo(this.selectorControlContainer);

	$(document.createElement('label'))
		.addClass('filter-selector-control')
		.attr('for', selectorID)
		.text(this.label)
		.appendTo(this.selectorControlContainer);
};

/**
 * Responds to the filter checked status being changed
 * @private
 */
BM.Filter.prototype.stateChanged = function()
{
	var self = this;

	if (!this.isChecked())
	{
		self.deactivateFilterControl();
		this.filterControlContainer.hide('slide', {
			direction: 'up',
			easing: 'swing'
		}, 150);
	}
	else
	{
		var setFocus = BM.StateManagement.initialStateLoaded();
		this.filterControlContainer.show('slide', {
			direction: 'up',
			easing: 'swing'
		}, 150, function() {
			// Do not set focus during initialisation or when restoring from state
			if (setFocus)
				self.activateFilterControl();
		});
	}
};

/**
 * Returns whether the filter is currently enabled (checked)
 * @returns {boolean}
 */
BM.Filter.prototype.isChecked = function()
{
	return this.selectorControl.first().prop('checked') === true;
};

/**
 * Enables the filter, showing its UI control
 * @param [callback]
 */
BM.Filter.prototype.check = function(callback)
{
	if (!this.isChecked())
		this.selectorControl.iCheck('check', callback);
	else if(callback)
		callback();
};

/**
 * Hides and disables the filter
 * @param [callback]
 */
BM.Filter.prototype.uncheck = function(callback)
{
	if (this.isChecked())
		this.selectorControl.iCheck('uncheck', callback);
	else if(callback)
		callback();
};

/**
 * Brings focus to the filter control. Can be overridden to perform specific actions when the filter control is revealed
 */
BM.Filter.prototype.activateFilterControl = function()
{
	if (this.filterControl)
		this.filterControl.focus();
};

/**
 * Shifts focus away from the filter control
 */
BM.Filter.prototype.deactivateFilterControl = function()
{
	if (this.filterControl)
		this.filterControl.blur();
};

/**
 * Returns the filter's value array
 * @returns {[]}
 */
BM.Filter.prototype.getValues = function()
{
	return this.values;
};

/**
 * Gets the friendly name of the filter (same as the filter's selector control label)
 * @returns {string}
 */
BM.Filter.prototype.getFriendlyName = function()
{
	return this.label;
};

/**
 * Sets the values of the filter
 * @param {[]} values
 */
BM.Filter.prototype.setValues = function(values)
{
	this.values = values;
	this.update();
};

/**
 * Prototype to update the filter's UI based on updated underlying values (this.values)
 * @abstract
 */
BM.Filter.prototype.update = function() {};

/**
 * Prototype to restore the filter's default values
 * @abstract
 **/
BM.Filter.prototype.reset = function() {};

/**
 * Prototype method to return a data service query conditional statement, for use by the filter controller (i.e. 'Fr_Force_Present ge 10')
 * @returns {string}
 * @abstract
 */
BM.Filter.prototype.toDataFilterString = function() {};

/**
 * Prototype method to construct an ElasticSearch query object, for use a part of a MATCH query component
 * @returns {{}}
 * @abstract
 */
BM.Filter.prototype.toElasticSearchFilter = function() {};

/**
 * Prototype to return a comma-delimited string containing the element's values. For string-based filters, the values should be escaped.
 * This method should not include the filter ID, as this is handled by the controller. Example return format: 2,52,3
 * @returns {string}
 * @abstract
 */
BM.Filter.prototype.serialiseState = function() {};

/**
 * Prototype to restore the filter control from a serialised state
 * @param {string} serialisedState - Comma-separated list of values. These may need to be URI decoded depending on the expected type for each filter.
 * @abstract
 */
BM.Filter.prototype.parseState = function(serialisedState) {};

/**
 * Manages the creation and display of filters and the generation of a data service query parameter based on each filter's associated data field
 * @param {string} id - Unique identifier for the filter in browser state
 * @param {jQuery} containerElement - DOM selector for the container the filter controls will be added to
 * @constructor
 */
BM.FilterController = function(id, containerElement)
{
	/** @type {string} */
	this.id = id;

	/** @type {jQuery} */
	this.containerElement = containerElement;

	/** @type {[BM.Filter]} */
	this.filters = [];
};

/**
 * Sets the filter's sidebar panel visibility
 * @param {boolean} visible
 */
BM.FilterController.prototype.setVisibility = function(visible)
{
	var panel = this.containerElement.closest('.panel-section');
	var panelHeading = panel.prev('.panel-section-heading');

	if (visible)
	{
		panelHeading.removeClass('hidden');
		panel.removeClass('hidden');
	}
	else
	{
		panelHeading.addClass('hidden');
		panel.addClass('hidden');
	}
};

/**
 * @param {number} resultCount
 */
BM.FilterController.prototype.updateResultCount = function (resultCount) {
	var resultCountEl = this.containerElement.siblings('.result-count');
	if (resultCount === 0)
		resultCountEl.html("No records found");
	else if (resultCount === 1)
		resultCountEl.html("1 record");
	else
		resultCountEl.html(resultCount.toLocaleString() + " records");
};

/**
 * Returns an array containing the currently enabled filters
 * @returns {Array}
 */
BM.FilterController.prototype.getEnabledFilters = function()
{
	var filters = [];
	$.each(this.filters, function(i, filter) {
		if (filter.isChecked())
			filters.push(filter);
	});
	
	return filters;
};

/**
 * Retrieves a filter by its ID
 * @param {BM.FilterID,*} filterID
 * @returns {BM.Filter}
 */
BM.FilterController.prototype.getFilterById = function(filterID)
{
	for(var i = 0; i < this.filters.length; i++)
	{
		var filter = this.filters[i];
		if (filter.filterID === filterID)
			return filter;
	}

	return null;
};

/**
 * Adds a filter to the controller
 * @param filter - Instance of a BM.Filter or derived class
 * @returns {BM.FilterController}
 */
BM.FilterController.prototype.addFilter = function(filter)
{
	if (filter)
	{
		this.filters.push(filter);

		filter.selectorControl.on('ifToggled', function() {
			filter.stateChanged();
		});

		this.containerElement
			.append(filter.selectorControlContainer)
			.append(filter.filterControlContainer);

		BM.initICheckUIControl(filter.selectorControl);
	}

	return this;
};

/**
 * Creates a data service query parameter to filter results based on each field's dataField
 * @returns {string}
 */
BM.FilterController.prototype.toDataFilterString = function()
{
	var queryString = "";
	$.each(this.filters, function(i, filter) {
		if (filter.isChecked())
		{
			var filterParameter = filter.toDataFilterString();
			if (filterParameter.length > 0)
			{
				if (queryString.length > 0)
					queryString += ' and ';

				queryString += '(' + filterParameter + ')';
			}
		}
	});

	return queryString;
};

BM.FilterController.prototype.toElasticSearchQuery = function()
{
	var queryParams = [];
	$.each(this.filters, function(i, filter) {
		if (filter.isChecked())
		{
			var filterParameter = filter.toElasticSearchFilter();
			if (filterParameter)
				queryParams.push(filterParameter);
		}
	});

	return {
		"bool": {
			"must": queryParams
		}
	};
};

BM.FilterController.prototype.clearAllFilters = function()
{
	for(var i = 0; i < this.filters.length; i++)
	{
		var filter = this.filters[i];
		filter.reset();
		filter.uncheck();
	}
};

/**
 * De-focuses all filter input controls, such as when the filter is applied.
 * This removes elements such as the unit selection tooltip out of the way
 */
BM.FilterController.prototype.deactivateAllFilterControls = function()
{
	for(var i = 0; i < this.filters.length; i++)
	{
		this.filters[i].deactivateFilterControl();
	}
};

/**
 * Create a delimited list of enabled filters and their values.
 * Individual filters are separated by semicolons, while their values are separated by commas.
 * Example format: contact-units-involved:3RAR;contact-en-strength:2,52;contact-fr-strength:5,50
 * @returns {string}
 */
BM.FilterController.prototype.serialiseState = function()
{
	var serialisedState = "";

	for(var i = 0; i < this.filters.length; i++)
	{
		var filter = this.filters[i];
		if (filter.isChecked())
		{
			var filterValue = filter.serialiseState();

			if (filterValue.length > 0)
			{
				if (serialisedState.length > 0)
					serialisedState += ';';

				serialisedState += filter.filterID + ":" + filterValue;
			}
		}
	}

	return serialisedState;
};

/**
 * Restores the filters based on a serialised state
 * @param {string} serialisedState - String containing semi-colon separated filters, each in the format: [filter name]:[filter value]
 */
BM.FilterController.prototype.parseState = function(serialisedState)
{
	if (serialisedState)
	{
		if (serialisedState.length > 0)
		{
			var filters = serialisedState.split(';');
			for (var i = 0; i < filters.length; i++)
			{
				// Split the filter into its name and value pairs
				var filterParts = filters[i].split(':');

				if (filterParts.length === 2)
				{
					var filter = this.getFilterById(filterParts[0]);
					if (filter && filterParts[1].length > 0)
					{
						filter.parseState(filterParts[1]);
						filter.check();
					}
				}
			}
		}
	}
};