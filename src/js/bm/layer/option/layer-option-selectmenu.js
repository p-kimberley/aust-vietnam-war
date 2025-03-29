/**
 * @param controlLabel
 * @param {{onChange:function(oldValue,newValue), options:[{name:string, value:*, selected:boolean}], defaultValue:{}}} options
 * @constructor
 * @extends {BM.LayerOption}
 */
BM.LayerOption.Selectmenu = function(controlLabel, options)
{
	BM.LayerOption.call(this, controlLabel);
	this.options = options;

	/**
	 * Selectmenu element
	 * @type {jQuery}
	 */
	this.dropdown = undefined;
};

BM.LayerOption.Selectmenu.prototype = Object.create(BM.LayerOption.prototype);
BM.LayerOption.Selectmenu.prototype.constructor = BM.LayerOption.Selectmenu;

BM.LayerOption.Selectmenu.prototype.render = function(parentContainer)
{
	BM.LayerOption.prototype.render.call(this, parentContainer);

	var self = this;
	var options = this.options.options;

	this.dropdown = $(document.createElement('select')).appendTo(this.control);

	$.each(options, function(i, option) {
		var optionEl = $(document.createElement('option'))
			.text(option.name);

		if (option.value)
			optionEl.attr('value', option.value || null);
		if (self.options.defaultValue && self.options.defaultValue === option)
			optionEl.attr('selected', 'selected');
		else if (option.selected)
			optionEl.attr('selected', 'selected');

		optionEl.appendTo(self.dropdown);
	});

	this.dropdown.selectmenu({
		create: function(event, ui) {
			self.value = this.value;
		},
		change: function(event, ui) {
			var oldValue = self.value;
			self.value = ui.item.value;
			self.valueChanged(oldValue, self.value);
		}
	});
};