/**
 * Allows the user to select a single value from a drop-down list.
 * A name/value pair array defines what options are available. The dataField will be filtered using an 'equals' operator against
 * the selected value
 * @param {BM.FilterID, *} filterID
 * @param {string} label
 * @param {string} dataField
 * @param {{quoteValue,nameValueArray: [{name, value},*],dataSource: {query,nameField,valueField}}, {}} options - Object containing either a name/value array or the specs of a data source
 * @param [callback]
 * @constructor
 * @extends {BM.Filter}
 */
BM.Filter.SingleSelectList = function(filterID, label, dataField, options, callback)
{
	BM.Filter.call(this, filterID, label, dataField);

	var self = this;
	this.options = options;
	this.listItems = [];
	this.filterControl = $(document.createElement('select'))
		.addClass('map-filter-dropdown')
		.attr('id', filterID)
		.attr('tabindex', 0)
		.appendTo(this.filterControlContainer);

	var createOption = function(name, value) {
		self.listItems.push({ name: name, value: value});
		$(document.createElement('option'))
			.text(name ? name : '(not set)')
			.attr('value', value)
			.appendTo(self.filterControl);
	};

	var finish = function() {
		self.filterControl.selectmenu({
			width: '100%',
			appendTo: '#map-container',
			change: function() {
				self.values[0] = self.filterControl.val();
			}
		});

		if (callback)
			callback();
	};

	if (options.dataSource)
	{
		$.getJSON(options.dataSource.query, function(data) {
			if (data.length > 0)
			{
				self.defaultValue = data[0][options.dataSource.valueField];
				self.values[0] = self.defaultValue;

				$.each(data, function(i, item) {
					createOption(item[options.dataSource.nameField], item[options.dataSource.valueField]);
				});

				finish();
			}
		}).fail(function() {
			InfoDialog('Filter Initialisation', 'The data values for the filter \'' + filterID + '\' could not be loaded.<br /><br />Please refresh the page and try again.');
		});
	}
	else if(options.nameValueArray)
	{
		if (options.nameValueArray.length > 0)
		{
			self.defaultValue = options.nameValueArray[0].value;
			self.values[0] = self.defaultValue;

			for (var i = 0; i < options.nameValueArray.length; i++)
			{
				createOption(options.nameValueArray[i].name, options.nameValueArray[i].value);
			}
		}

		finish();
	}
	else
	{
		console.log('Warning: Single select filter ' + filterID + ' data source not specified');
		finish();
	}
};

BM.Filter.SingleSelectList.prototype = Object.create(BM.Filter.prototype);
BM.Filter.SingleSelectList.prototype.constructor = BM.Filter.SingleSelectList;

BM.Filter.SingleSelectList.prototype.update = function()
{
	this.filterControl
		.val(this.values[0])
		.selectmenu('refresh');
};

BM.Filter.SingleSelectList.prototype.reset = function()
{
	this.values[0] = this.defaultValue;
	this.update();
};

BM.Filter.SingleSelectList.prototype.toDataFilterString = function()
{
	var quoteChar = this.options.quoteValue ? "'" : "";
	return this.dataField + " eq " + quoteChar + this.values[0].toString() + quoteChar;
};

BM.Filter.SingleSelectList.prototype.toElasticSearchFilter = function()
{
	var quoteChar = this.options.quoteValue ? '"' : '';
	return JSON.parse('{ "match": { "' + this.dataField + (this.options.quoteValue ? '.raw' : '') + '": ' + quoteChar + this.values[0].toString() + quoteChar + '} }');
};

BM.Filter.SingleSelectList.prototype.serialiseState = function()
{
	return encodeURIComponent(this.values[0]);
};

/**
 * Parses a serialised state string and sets the value of the control
 * @param {string} serialisedState
 */
BM.Filter.SingleSelectList.prototype.parseState = function(serialisedState)
{
	var value = decodeURIComponent(serialisedState);
	if (value)
	{
		for(var i = 0; i < this.listItems.length; i++)
		{
			var currentItem = this.listItems[i];
			if (currentItem.value == value)
			{
				this.values[0] = currentItem.value;
				this.update();
				return;
			}
		}
	}

	console.log('Warning: Value specified for filter ' + this.filterID + ' is outside of the expected range');
};