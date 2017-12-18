/**
 * OpenLayers tile layer class designed to work with raster sources
 * @param {BM.LayerType} type
 * @param {string} title
 * @param {{}} [options] - Additional options passed to the WMS server
 * @param {number} [zIndex]
 * @constructor
 * @extends {BM.Layer}
 */
BM.Layer.Tile = function(type, title, options, zIndex)
{
	BM.Layer.call(this, type, title, zIndex, this.generate);

	this.options = options;
};

BM.Layer.Tile.prototype = Object.create(BM.Layer.prototype);
BM.Layer.Tile.prototype.constructor = BM.Layer.Tile;

/**
 * @param callback
 * @private
 */
BM.Layer.Tile.prototype.generate = function(callback)
{
	if (!this.olLayer)
	{
		this.olLayer = new ol.layer.Tile({
			visible: false,
			minResolution: this.options.minResolution || undefined,
			maxResolution: this.options.maxResolution || undefined,
			source: new ol.source.TileWMS({
				url: this.options.url,
				crossOrigin: 'anonymous',
				serverType: 'geoserver',
				params: {
					FORMAT: 'image/png8',
					VERSION: '1.1.1',
					STYLES: '',
					LAYERS: this.options.layers,
					TILED: true
				}
			})
		});

		BM.map.addLayer(this.olLayer);
	}

	if (callback)
		callback();
};