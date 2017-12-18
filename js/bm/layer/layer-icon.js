/**
 * Displays image icons at Lat/Lon coordinates specified by a data source
 * @param {BM.LayerType} type
 * @param {string} title
 * @param {number} [zIndex]
 * @param {string} dataSource
 * @param {string} iconUrl
 * @constructor
 * @extends {BM.Layer}
 */
BM.Layer.Icon = function(type, title, zIndex, dataSource, iconUrl)
{
	BM.Layer.call(this, type, title);

	this.dataSource = dataSource;
	this.iconUrl = iconUrl;
	this.markers = new ol.Collection();
};

BM.Layer.Icon.prototype = Object.create(BM.Layer.prototype);
BM.Layer.Icon.prototype.constructor = BM.Layer.Icon;

/**
 * @param [callback]
 * @param {boolean} closeLoadingIndicatorWhenDone
 */
BM.Layer.Icon.prototype.regenerate = function(callback, closeLoadingIndicatorWhenDone)
{
	if (this.olLayer)
		this.olLayer.getSource().clear();

	BM.Layer.prototype.regenerate.call(this, callback, closeLoadingIndicatorWhenDone);
};

/**
 * @param [callback]
 */
BM.Layer.Icon.prototype.generate = function(callback)
{
	var self = this;
	if (this.dataSource)
	{
		$.getJSON(this.dataSource, function(data) {
			if (data)
			{
				var style = new ol.style.Style({
					image: new ol.style.Icon({
						src: self.iconUrl,
						size: [16, 16],
						rotateWithView: true,
						scale: 1
					})
				});

				$.each(data, function(i, item) {
					var marker = new ol.Feature({
						geometry: new ol.geom.Point(ol.proj.transform([item.Lon, item.Lat], 'EPSG:4326'))
					});

					marker.setStyle(style);
					self.markers.push(marker);
				});

				self.olLayer = new ol.layer.Vector({
					source: new ol.source.Vector({
						features: self.markers
					})
				});

				BM.map.addLayer(self.olLayer);
			}

			if (callback)
				callback();
		});
	}
	else
	{
		console.log('Error: No data source specified for layer: ' + this.type);
		if (callback)
			callback();
	}
};