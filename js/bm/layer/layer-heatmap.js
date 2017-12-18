/**
 * Generates an overlay showing data value concentrations. The field used is determined by the BM.LayerType used
 * @param {BM.LayerType} type
 * @param {string} title
 * @param {{}} [layerOptions]
 * @constructor
 * @extends {BM.Layer}
 */
BM.Layer.Heatmap = function(type, title, layerOptions)
{
	var self = this;

	var opts = {
		heatmapBlur: new BM.LayerOption.Slider('Blur size (pixels)', {
			min: 1,
			max: 50,
			defaultValue: 15,
			onChange: function(oldValue, newValue) {
				if (self.olLayer)
					self.olLayer.setBlur(newValue);
			}
		}),
		heatmapRadius: new BM.LayerOption.Slider('Radius (pixels)', {
			min: 1,
			max: 20,
			defaultValue: 8,
			onChange: function(oldValue, newValue) {
				if (self.olLayer)
					self.olLayer.setRadius(newValue);
			}
		})
	};

	$.extend(opts, opts, layerOptions);
	BM.Layer.call(this, type, title, 0, opts);

	// Can be overridden by subclass
	this.gradient = ['#00f', '#0ff', '#0f0', '#ff0', '#f00'];
};

BM.Layer.Heatmap.prototype = Object.create(BM.Layer.prototype);
BM.Layer.Heatmap.prototype.constructor = BM.Layer.Heatmap;

/**
 * @interface
 * @param [callback]
 * @protected
 */
BM.Layer.Heatmap.prototype.generate = function(callback) {};