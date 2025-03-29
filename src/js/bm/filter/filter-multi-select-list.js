/**
 * Allows the user to select multiple values from a drop-down list.
 * A name/value pair array defines what options are available. The dataField will be filtered using an 'equals' operator against
 * the selected value
 * @param {BM.FilterID} filterID
 * @param {string} label
 * @param {string} dataField
 * @param {{quoteValue,nameValueArray: [{id,text},*],dataSource: {query,nameField,secondaryField,valueField}}, {}} options - Object containing either a name/value array or the specs of a data source
 * @param [callback]
 * @constructor
 * @extends {BM.Filter}
 */
BM.Filter.MultiSelectList = function(filterID, label, dataField, options, callback)
{
	BM.Filter.call(this, filterID, label);

	var self = this;
	this.options = options;
	this.listItems = [];
	this.values = [];
	this.dataField = dataField;
	this.filterControl = $(document.createElement('select'))
		.attr('id', filterID)
		.attr('multiple', 'multiple')
		.appendTo(this.filterControlContainer);

	var initControl = function(data)
	{
		self.filterControl.select2({
			placeholder: 'Select one or more from the list',
			data: data
		});

		self.filterControl
			.on('change', function() {
				self.values = self.filterControl.val();
				self.hideTooltip();
			})
			.on('blur', function() {
				self.hideTooltip();
			});

		if (callback)
			callback();
	};

	if (options.dataSource)
	{
		this.dataSource = options.dataSource;
		$.getJSON(options.dataSource.query, function(data) {
			var optionItems = [];
			var secondaryField = options.dataSource.secondaryField;
			$.each(data, function(i, item) {
				var nameField = item[options.dataSource.nameField];
				if (!nameField || nameField == "")
					nameField = "(none)";

				optionItems.push({
					text: nameField + (secondaryField ? ' (' + item[secondaryField] + ')' : ''),
					id: item[options.dataSource.valueField]
				});
			});

			initControl(optionItems);

		}).fail(function() {
			InfoDialog('Filter Initialisation', 'The data values for the filter \'' + filterID + '\' could not be loaded.<br /><br />Please refresh the page and try again.');
		});
	}
	else if(options.nameValueArray)
	{
		if (options.nameValueArray.length > 0)
			initControl(options.nameValueArray);
	}
	else
	{
		console.log('Warning: Multi select filter ' + filterID + ' data source not specified');
		if (callback)
			callback();
	}
};

BM.Filter.MultiSelectList.prototype = Object.create(BM.Filter.prototype);
BM.Filter.MultiSelectList.prototype.constructor = BM.Filter.MultiSelectList;

BM.Filter.MultiSelectList.prototype.activateFilterControl = function()
{
	this.showTooltip();
	if (this.filterControl)
		this.filterControl.focus();
};

BM.Filter.MultiSelectList.prototype.deactivateFilterControl = function()
{
	if (this.filterControl)
	{
		this.filterControlContainer
			.tooltipster()
			.tooltipster('destroy');
	}
};

/**
 * @private
 */
BM.Filter.MultiSelectList.prototype.showTooltip = function()
{
	if (this.filterControl)
	{
		this.filterControlContainer
			.tooltipster({
				content: 'Search by typing or pick items from the list. If choosing more than one item, records matching any of these items will be included in filter results.',
				position: 'left',
				trigger: 'custom',
				offsetY: 7
			})
			.tooltipster('show');
	}
};

/**
 * @private
 */
BM.Filter.MultiSelectList.prototype.hideTooltip = function()
{
	this.filterControlContainer
		.tooltipster()
		.tooltipster('hide');
};

/**
 * Synchronises the select control with the values array. If items in the values array are not matched with a corresponding entry in
 * the select control's option elements, they are removed from the values array.
 */
BM.Filter.MultiSelectList.prototype.update = function()
{
	if (this.filterControl)
	{
		this.filterControl.val(this.values);
		this.filterControl.trigger('change');
	}
};

/**
 * Clears all selected items
 */
BM.Filter.MultiSelectList.prototype.reset = function()
{
	this.values = [];
	this.update();
};

BM.Filter.MultiSelectList.prototype.toDataFilterString = function()
{
	var self = this;
	var filterString = "";
	var quoteChar = this.options.quoteValue ? "'" : "";
	if (this.values)
	{
		$.each(this.values, function(i, value) {
			if (filterString.length > 0)
				filterString += " or ";

			filterString += self.dataField + " eq " + quoteChar + value + quoteChar;
		});
	}

	return filterString;
};

BM.Filter.MultiSelectList.prototype.toElasticSearchFilter = function()
{
	var self = this;
	var queryParams = [];
	var quoteChar = this.options.quoteValue ? '"' : '';
	if (this.values)
	{
		$.each(this.values, function(i, value) {
			queryParams.push(quoteChar + value + quoteChar);
		});
	}

	return JSON.parse('{ "terms": { "' + this.dataField + (this.options.quoteValue ? '.raw' : '') + '": [' + queryParams.toString() + '] } }');
};

BM.Filter.MultiSelectList.prototype.serialiseState = function()
{
	var serialisedString = "";
	if (this.values)
	{
		for (var i = 0; i < this.values.length; i++)
		{
			if (serialisedString.length > 0)
				serialisedString += ",";

			serialisedString += encodeURIComponent(this.values[i]);
		}
	}

	return serialisedString;
};

/**
 * Parses a serialised state string. This implementation only supports numeric or boolean expressions. Override if string support is required.
 * @param {string} serialisedState
 */
BM.Filter.MultiSelectList.prototype.parseState = function(serialisedState)
{
	if (serialisedState)
	{
		var items = serialisedState.split(',');

		if (items)
		{
			if (items.length > 0)
			{
				this.values = [];
				for(var i = 0; i < items.length; i++)
				{
					this.values.push(decodeURIComponent(items[i]));
				}

				this.update();
				return;
			}
		}
	}

	console.log('No items to parse for filter ' + this.filterID + '. Reverting to defaults.');
	this.values = [];
	this.update();
};