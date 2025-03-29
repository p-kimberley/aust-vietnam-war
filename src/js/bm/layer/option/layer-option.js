/**
 * A type of option that is used to change the presentation of a given layer
 * @param {string} controlLabel - Label to use for the control
 * @class
 * @constructor
 */
BM.LayerOption = function(controlLabel)
{
	this.controlLabel = controlLabel;
	this.controlContainer = $(document.createElement('div'))
		.addClass('control-container')
		.append('<div class="label">' + this.controlLabel + '</div>');
	this.control = $(document.createElement('div'))
		.addClass('control')
		.appendTo(this.controlContainer);
	this.value = undefined;
	this.options = this.options || {};
};

/**
 * Generates the DOM for the layer option control and injects it into the control element
 * @param {jQuery} parentContainer
 * @interface
 */
BM.LayerOption.prototype.render = function(parentContainer)
{
	parentContainer.append(this.controlContainer);
};

/**
 * Triggers the event notifying the layer that an option has changed
 * @param {*} oldValue
 * @param {*} newValue
 * @protected
 */
BM.LayerOption.prototype.valueChanged = function(oldValue, newValue)
{
	if (this.options.onChange)
		this.options.onChange(oldValue, newValue);
	else
		console.warn('LayerOption.onChange not set for option with label: ' + this.controlLabel);
};

BM.LayerOption.prototype.getValue = function()
{
	return this.value;
};