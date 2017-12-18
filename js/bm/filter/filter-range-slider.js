/**
 * Range slider allowing the user to select a numeric value range
 * @param {BM.FilterID, *} filterID
 * @param {string} label
 * @param {string} dataField
 * @param {number} rangeMin
 * @param {number} rangeMax
 * @constructor
 * @extends {BM.Filter}
 */
BM.Filter.RangeSlider = function(filterID, label, dataField, rangeMin, rangeMax)
{
	BM.Filter.call(this, filterID, label, dataField);

	var self = this;
	this.rangeMin = rangeMin;
	this.rangeMax = rangeMax;
	var labelContainer = $(document.createElement('div'))
		.addClass('map-filter-range-slider-label-container')
		.appendTo(this.filterControlContainer);
	this.controlMin = $(document.createElement('input'))
		.attr('type', 'text')
		.addClass('map-filter-range-slider-text left')
		.on('keypress', function(event) {
			validateInput(event);
		})
		.on('keyup', function() {
			self.updateFromInput();
		})
		.appendTo(labelContainer);
	this.controlMax = $(document.createElement('input'))
		.attr('type', 'text')
		.attr('align', 'right')
		.addClass('map-filter-range-slider-text right')
		.on('keypress', function(event) {
			validateInput(event);
		})
		.on('keyup', function() {
			self.updateFromInput();
		})
		.appendTo(labelContainer);
	this.filterControl = $(document.createElement('div'))
		.addClass('map-filter-range-slider')
		.slider( {
			range: true,
			min: rangeMin,
			max: rangeMax,
			values: [rangeMin, rangeMax],
			slide: function(event, ui) {
				self.values = ui.values;
				self.updateTextFields();
			}
		})
		.appendTo(this.filterControlContainer);

	/**
	 * Only permits alphanumeric and backspace, delete and enter as permitted chars
	 * @param event
	 */
	var validateInput = function(event)
	{
		if ($.inArray(event.which, [46, 8, 13]) === -1 && (event.shiftKey || (event.which < 48 || event.which > 57)))
		{
			event.preventDefault();
		}
	};

	// Prime the slider labels
	self.values = this.filterControl.slider('values');
	this.updateTextFields();
};

BM.Filter.RangeSlider.prototype = Object.create(BM.Filter.prototype);
BM.Filter.RangeSlider.prototype.constructor = BM.Filter.RangeSlider;

/**
 * Updates the slider based on manual range text input. Only commits the new value to the values array and slider if it falls within bounds.
 */
BM.Filter.RangeSlider.prototype.updateFromInput = function()
{
	var min = parseInt(this.controlMin.val());
	var max = parseInt(this.controlMax.val());

	// Only store the new value if it falls within bounds
	if (min >= this.rangeMin && min <= max)
		this.values[0] = min;
	if (max >= min && max <= this.rangeMax)
		this.values[1] = max;

	this.filterControl.slider('values', this.values);
};

BM.Filter.RangeSlider.prototype.update = function()
{
	this.updateTextFields();
	this.filterControl.slider('values', this.values);
};

BM.Filter.RangeSlider.prototype.updateTextFields = function()
{
	this.controlMin.val(this.values[0]);
	this.controlMax.val(this.values[1]);
};

BM.Filter.RangeSlider.prototype.reset = function()
{
	this.values = [this.rangeMin, this.rangeMax];
	this.update();
};

BM.Filter.RangeSlider.prototype.toDataFilterString = function()
{
	return this.dataField + " ge " + this.values[0] + " and " + this.dataField + " le " + this.values[1];
};

BM.Filter.RangeSlider.prototype.toElasticSearchFilter = function()
{
	var rangeQuery = JSON.parse('{ "' + this.dataField + '": { "gte": ' + this.values[0] + ', "lte": ' + this.values[1] + ' } }');
	return {
		'range': rangeQuery
	};
};

BM.Filter.RangeSlider.prototype.serialiseState = function()
{
	return this.values[0] + "," + this.values[1];
};

BM.Filter.RangeSlider.prototype.parseState = function(serialisedState)
{
	// Parse range min/max values from the serialised string
	if (serialisedState)
	{
		var parsedValues = serialisedState.split(',');
		if (parsedValues)
		{
			if (parsedValues.length === 2)
			{
				this.values = parsedValues;
				this.update();
				return;
			}
		}

		console.log('Warning: Invalid range slider URI parameters for filter: ' + this.filterID + '. Resorting to defaults.');
		this.values = [this.rangeMin, this.rangeMax];
		this.update();
	}
};