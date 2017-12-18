/**
 * Simple text-box filter that tests if the specified data field contains a certain string
 * @param {BM.FilterID, *} filterID
 * @param {string} label
 * @param {string} dataField
 * @param {number} maxLength - Input field length limit
 * @param {string} placeholderText - Text to display initially in the text box
 * @constructor
 * @extends {BM.Filter}
 */
BM.Filter.TextBox = function(filterID, label, dataField, maxLength, placeholderText)
{
	BM.Filter.call(this, filterID, label, dataField);

	var self = this;
	this.values[0] = '';
	this.filterControl = $(document.createElement('input'))
		.addClass('map-filter-textbox')
		.attr('id', filterID)
		.attr('type', 'text')
		.attr('maxlength', maxLength)
		.attr('placeholder', placeholderText)
		.on('change', function() {
			self.values[0] = self.filterControl.val();
		})
		.appendTo(this.filterControlContainer);
};

BM.Filter.TextBox.prototype = Object.create(BM.Filter.prototype);
BM.Filter.TextBox.prototype.constructor = BM.Filter.TextBox;

BM.Filter.TextBox.prototype.update = function()
{
	this.filterControl.val(this.values[0]);
};

BM.Filter.TextBox.prototype.reset = function()
{
	this.values[0] = '';
	this.update();
};

BM.Filter.TextBox.prototype.toDataFilterString = function()
{
	return "indexof(" + this.dataField + "," + encodeURIComponent("'" + this.values[0] + "'") + ") ge 0";
};

BM.Filter.TextBox.prototype.toElasticSearchFilter = function()
{
	return JSON.parse('{ "term": { "' + this.dataField + '": { "value": "' + this.values[0] + '" } } }');
};

BM.Filter.TextBox.prototype.serialiseState = function()
{
	return encodeURIComponent(this.values[0]);
};

BM.Filter.TextBox.prototype.parseState = function(serialisedState)
{
	if (serialisedState)
	{
		this.values[0] = decodeURIComponent(serialisedState);
		this.update();
	}
};