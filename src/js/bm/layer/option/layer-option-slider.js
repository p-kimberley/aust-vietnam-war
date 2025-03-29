/**
 * @param controlLabel
 * @param {{onChange:function(oldValue,newValue), min:number, max:number, [step]:number, [defaultValue]:number}} options
 * @constructor
 * @extends {BM.LayerOption}
 */
BM.LayerOption.Slider = function(controlLabel, options)
{
	BM.LayerOption.call(this, controlLabel);
	this.options = options;
	this.slider = undefined;
};

BM.LayerOption.Slider.prototype = Object.create(BM.LayerOption.prototype);
BM.LayerOption.Slider.prototype.constructor = BM.LayerOption.Slider;

BM.LayerOption.Slider.prototype.render = function(parentContainer)
{
	BM.LayerOption.prototype.render.call(this, parentContainer);

	var self = this;
	var slider = $(document.createElement('div')).appendTo(this.control);
	var handle = $(document.createElement('div'))
		.addClass('ui-slider-handle')
		.append('<span></span>')
		.appendTo(slider);

	this.slider = slider.slider({
		min: this.options.min,
		max: this.options.max,
		step: this.options.step || 1,
		range: 'min',
		value: this.options.defaultValue || this.options.max,
		create: function() {
			var value = $(this).slider('value');
			self.value = value;
			handle.find('span').text(value !== self.options.max ? value : '');
		},
		slide: function(event, ui) {
			var oldValue = self.value;
			handle.find('span').text(ui.value !== self.options.max ? ui.value : '');
			self.value = ui.value;
			self.valueChanged(oldValue, self.value);
		}
	});
};

BM.LayerOption.Slider.prototype.setMin = function(min)
{
	if (this.slider)
		this.slider.slider('option', 'min', min);
};

BM.LayerOption.Slider.prototype.setMax = function(max)
{
	if (this.slider)
		this.slider.slider('option', 'max', max);
};